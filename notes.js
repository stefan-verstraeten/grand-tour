// The journal: notes and photos. Everything is kept on the phone first; when the trip
// data holds a GitHub token (sync), each entry is also stored encrypted as
// notes/<id>.json on a separate branch (a photo's image as photos/<id>.bin), so
// both phones see each other's entries. Without a token, or offline, the app keeps
// working and syncs later.

import { encryptText, decryptText, encryptBytes, decryptBytes, toB64 } from './crypto.js';
import { media } from './media.js';

const API = 'https://api.github.com';

export function createNotes({ key, sync, store, onChange }) {
  const notes = store.get('notes:v1', {});
  const shas = store.get('notes:sha', {});
  const queue = new Set(store.get('notes:queue', []));
  const uploaded = new Set(store.get('notes:uploaded', []));
  let busy = null;
  let again = false;
  let branchReady = false;
  let lastError = '';
  let timer;

  const enabled = !!(sync && sync.token && sync.owner && sync.repo && sync.branch);

  function persist() {
    store.set('notes:v1', notes);
    store.set('notes:sha', shas);
    store.set('notes:queue', [...queue]);
    store.set('notes:uploaded', [...uploaded]);
  }

  const live = () => Object.values(notes).filter((n) => !n.deleted).sort((a, b) => a.created.localeCompare(b.created));
  const list = live;

  function save(note) {
    const now = new Date().toISOString();
    const n = { ...notes[note.id], ...note, updated: now };
    if (!n.created) n.created = now;
    notes[n.id] = n;
    queue.add(n.id);
    persist();
    onChange();
    syncSoon();
    return n;
  }

  function remove(id) {
    if (!notes[id]) return;
    notes[id] = { ...notes[id], deleted: true, updated: new Date().toISOString() };
    if (notes[id].type === 'photo') media.del(id).catch(() => {});
    queue.add(id);
    persist();
    onChange();
    syncSoon();
  }

  async function gh(path, opts = {}) {
    const res = await fetch(`${API}/repos/${sync.owner}/${sync.repo}${path}`, {
      ...opts,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${sync.token}`,
        Accept: opts.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (res.status === 404 && (!opts.method || opts.method === 'GET')) return null;
    if (!res.ok) {
      const why = await res.json().then((d) => d.message, () => '');
      throw new Error({
        401: 'the GitHub token has expired or is invalid.',
        403: `the token may not write to ${sync.repo} (it needs Contents “Read and write” on that repository).`,
        404: `the token has no access to ${sync.owner}/${sync.repo}.`,
      }[res.status] || `GitHub answered ${res.status}${why ? ` (${why})` : ''}.`);
    }
    if (opts.raw) return new Uint8Array(await res.arrayBuffer());
    return res.status === 204 ? {} : res.json();
  }

  async function ensureBranch() {
    if (branchReady) return;
    if (!(await gh(`/git/ref/heads/${sync.branch}`))) {
      const repo = await gh('');
      const base = await gh(`/git/ref/heads/${repo.default_branch}`);
      await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${sync.branch}`, sha: base.object.sha }) });
    }
    branchReady = true;
  }

  async function putFile(path, b64, message) {
    const cur = await gh(`${path}?ref=${sync.branch}`);
    return gh(path, { method: 'PUT', body: JSON.stringify({ message, content: b64, branch: sync.branch, ...(cur ? { sha: cur.sha } : {}) }) });
  }

  async function delFile(path, message) {
    const cur = await gh(`${path}?ref=${sync.branch}`);
    if (cur) await gh(path, { method: 'DELETE', body: JSON.stringify({ message, sha: cur.sha, branch: sync.branch }) });
  }

  async function push(id) {
    const n = notes[id];
    const path = `/contents/notes/${id}.json`;
    if (!n || n.deleted) {
      await delFile(path, 'Journal entry removed');
      if (n?.type === 'photo') await delFile(`/contents/photos/${id}.bin`, 'Photo removed');
      delete notes[id];
      delete shas[id];
      uploaded.delete(id);
      media.del(id).catch(() => {});
    } else {
      // A photo's image goes up first, so other phones never see a photo they cannot load.
      if (n.type === 'photo' && !uploaded.has(id)) {
        const blob = await media.get(id);
        if (blob) {
          const bytes = await encryptBytes(key, new Uint8Array(await blob.arrayBuffer()));
          await putFile(`/contents/photos/${id}.bin`, toB64(bytes), 'Photo');
          uploaded.add(id);
        }
      }
      const cur = await gh(`${path}?ref=${sync.branch}`);
      const file = JSON.stringify({ v: 1, data: await encryptText(key, JSON.stringify(n)) });
      const res = await gh(path, {
        method: 'PUT',
        body: JSON.stringify({ message: 'Journal entry', content: btoa(file), branch: sync.branch, ...(cur ? { sha: cur.sha } : {}) }),
      });
      shas[id] = res.content.sha;
    }
    queue.delete(id);
    persist();
  }

  async function pull() {
    // The tree lists every file; a contents listing stops at 1,000 entries.
    const tree = await gh(`/git/trees/${sync.branch}?recursive=1`);
    const remote = new Map((tree?.tree || []).filter((f) => /^notes\/[^/]+\.json$/.test(f.path)).map((f) => [f.path.slice(6, -5), f.sha]));
    for (const [id, sha] of remote) {
      if (queue.has(id) || shas[id] === sha) continue;
      const f = await gh(`/contents/notes/${id}.json?ref=${sync.branch}`);
      const box = JSON.parse(atob(f.content.replace(/\s/g, '')));
      notes[id] = JSON.parse(await decryptText(key, box.data));
      shas[id] = sha;
    }
    // A synced note that disappeared remotely was deleted on another phone.
    for (const id of Object.keys(notes)) {
      if (!remote.has(id) && !queue.has(id) && shas[id]) {
        if (notes[id].type === 'photo') media.del(id).catch(() => {});
        delete notes[id];
        delete shas[id];
      }
    }
    persist();
  }

  // The image of a photo: from this phone, or downloaded once from another phone's upload.
  async function photo(id) {
    const local = await media.get(id).catch(() => null);
    if (local) return local;
    if (!enabled || !navigator.onLine) return null;
    const enc = await gh(`/contents/photos/${id}.bin?ref=${sync.branch}`, { raw: true });
    if (!enc) return null;
    const blob = new Blob([await decryptBytes(key, enc)], { type: 'image/jpeg' });
    await media.put(id, blob).catch(() => {});
    uploaded.add(id);
    persist();
    return blob;
  }

  function syncNow() {
    if (!enabled || !navigator.onLine) return Promise.resolve();
    if (busy) {
      // Entries saved while a sync runs go up in a second round right after it.
      again = true;
      return busy;
    }
    busy = (async () => {
      try {
        await ensureBranch();
        do {
          again = false;
          for (const id of [...queue]) await push(id);
        } while (again && queue.size);
        await pull();
        lastError = '';
      } catch (e) {
        lastError = e.message || 'syncing failed';
      } finally {
        busy = null;
        onChange();
        if (again && !lastError) { again = false; syncSoon(); }
      }
    })();
    return busy;
  }

  function syncSoon() {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 600);
  }

  function status() {
    if (!enabled) return { kind: 'local', text: 'Kept on this phone only: sharing is not set up yet.' };
    if (lastError) return { kind: 'error', text: `Not shared: ${lastError}` };
    if (queue.size) return { kind: 'pending', text: (busy ? 'Sharing…' : navigator.onLine ? `${queue.size} ${queue.size === 1 ? 'entry' : 'entries'} still to share.` : `${queue.size} ${queue.size === 1 ? 'entry waits' : 'entries wait'} for a connection to be shared.`) };
    return { kind: 'ok', text: 'Shared with both phones.' };
  }

  return { list, save, remove, syncNow, status, photo, enabled };
}
