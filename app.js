import { decryptJSON, importContentKey, decryptBytes } from './crypto.js';
import { routeMap } from './routemap.js';
import { createNotes } from './notes.js';
import { media, preparePhoto } from './media.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Blank lines separate paragraphs; single line breaks (verse) are kept.
const paras = (text) => String(text || '').split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

// localStorage can throw (private mode) or be wiped; the app must work without it.
const NS = 'grandtour:';
const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(NS + k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

let DATA = null;
let KEY = null;
let DEV = false; // plaintext data from private/, only ever on a local dev server
let NOTES = null;
let draft = ''; // half-typed journal text survives redraws

/* ---------- icons: fine line drawings in ink ---------- */

const ICONS = {
  cuisine: '<path d="M3.5 17.5h17"/><path d="M5 17.5a7 7 0 0 1 14 0"/><path d="M12 10.5V9"/><path d="M10.4 8.6h3.2"/>',
  architecture: '<path d="M3.5 9 12 4.5 20.5 9"/><path d="M4.5 19.5h15"/><path d="M6.5 10.5v7M10 10.5v7M14 10.5v7M17.5 10.5v7"/><path d="M4.5 9.5h15"/>',
  museum: '<rect x="4" y="4.5" width="16" height="15" rx=".5"/><rect x="7" y="7.5" width="10" height="9"/><path d="M7 14l3-3 2.5 2.5L14 12l3 3"/>',
  culture: '<path d="M5 19.5c3-1 5.5-4.5 7.5-8.5 1.6-3.2 3.6-5.6 6.5-6.5-.4 3.4-2 6.4-5 8.6-2.2 1.6-4.6 2.3-7 2.4"/><path d="M5 19.5 9 15"/>',
  nature: '<path d="M2.5 18.5 9 9l3.6 5.2L15 11l6.5 7.5z"/><path d="M7.2 11.7 9 13l1.6-1.4"/>',
  drive: '<path d="M4.5 15.5v-3l2-5h11l2 5v3z"/><path d="M4.5 15.5v2h2.5v-2M17 15.5v2h2.5v-2"/><circle cx="8" cy="13" r=".6"/><circle cx="16" cy="13" r=".6"/><path d="M6.8 10.2h10.4"/>',
  stay: '<path d="M3.5 18.5v-11"/><path d="M3.5 14.5h17v4"/><path d="M20.5 14.5v-2.5a2.5 2.5 0 0 0-2.5-2.5h-7v5"/><circle cx="7" cy="11.5" r="1.6"/>',
  pin: '<path d="M12 21s6.5-6.1 6.5-11a6.5 6.5 0 0 0-13 0c0 4.9 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.2"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a10 10 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
  directions: '<path d="M20 4 4 11l7 2 2 7z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pen: '<path d="M4.5 19.5h4l10-10-4-4-10 10z"/><path d="M13 7l4 4"/>',
  practical: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8v.1"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  camera: '<path d="M3.5 8.5h3.5l1.5-2.5h7l1.5 2.5h3.5v10h-17z"/><circle cx="12" cy="13" r="3.3"/>',
};
const ic = (name, cls = 'ki') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const ORNAMENT = '<svg class="ornament" viewBox="0 0 54 14" aria-hidden="true"><path d="M0 7h20M34 7h20"/><path d="M27 2.5 31.5 7 27 11.5 22.5 7z"/></svg>';

const KIND = {
  cuisine: { label: 'Cuisine', section: 'At the table', plural: 'Tables' },
  architecture: { label: 'Architecture', section: 'Architecture', plural: 'Architecture' },
  museum: { label: 'Museums', section: 'Museums & collections', plural: 'Museums' },
  culture: { label: 'Culture', section: 'Culture & heritage', plural: 'Culture' },
  nature: { label: 'Nature', section: 'Landscapes & walks', plural: 'Nature' },
};
const STATUS = { idea: 'Idea', planned: 'Planned', tbc: 'To confirm', booked: 'Booked', visited: 'Visited' };

/* ---------- dates ---------- */

const DAY_MS = 86400000;
const parseDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => store.get('debug:today') || isoOf(new Date());
const fmt = (iso, opts) => parseDate(iso).toLocaleDateString('en-GB', opts);
const dayMonth = (iso) => fmt(iso, { day: 'numeric', month: 'short' });
const longDate = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const range = (a, b) => {
  if (!a) return '';
  if (!b || a === b) return dayMonth(a);
  const [da, db] = [parseDate(a), parseDate(b)];
  return da.getMonth() === db.getMonth() ? `${da.getDate()}–${dayMonth(b)}` : `${dayMonth(a)} – ${dayMonth(b)}`;
};
const nights = (s) => Math.round((parseDate(s.depart) - parseDate(s.arrive)) / DAY_MS);
const hours = (h) => { if (h == null) return ''; const m = Math.round(h * 60); return `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`; };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function tripDays() {
  const byDate = new Map((DATA.days || []).map((d) => [d.date, d]));
  const out = [];
  for (let d = parseDate(DATA.trip.start), n = 1; d <= parseDate(DATA.trip.end); d = new Date(d.getTime() + DAY_MS), n++) {
    const iso = isoOf(d);
    out.push({ n, date: iso, title: 'To be planned', legs: [], plan: [], ...(byDate.get(iso) || {}) });
  }
  return out;
}

function tripPhase() {
  const t = todayIso();
  if (t < DATA.trip.start) return { phase: 'before', days: Math.round((parseDate(DATA.trip.start) - parseDate(t)) / DAY_MS) };
  if (t > DATA.trip.end) return { phase: 'after' };
  return { phase: 'during', day: tripDays().find((d) => d.date === t) };
}

const stopById = (id) => DATA.stops.find((s) => s.id === id);
const expById = (id) => DATA.experiences.find((e) => e.id === id);
const expsAt = (stopId, kind) => DATA.experiences.filter((e) => e.stop === stopId && (!kind || e.kind === kind));
const currentStop = () => {
  const p = tripPhase();
  if (p.phase === 'during') return stopById(p.day.stop) || null;
  return null;
};

/* ---------- photos ---------- */

const imgUrls = new Map();

function imageUrl(name) {
  if (DEV) return Promise.resolve(`private/img/${encodeURIComponent(name)}.jpg`);
  const meta = DATA.images?.[name];
  if (!meta) return Promise.resolve(null);
  if (!imgUrls.has(name)) {
    imgUrls.set(name, fetch(`data/img/${meta.id}.bin`)
      .then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
      .then((buf) => decryptBytes(KEY, buf))
      .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: meta.type })))
      .catch(() => { imgUrls.delete(name); return null; }));
  }
  return imgUrls.get(name);
}

function photo(name, cls = 'photo', { credit = false } = {}) {
  if (!name) return `<div class="${cls} photo empty"></div>`;
  const c = credit && DATA.credits?.[name];
  return `<div class="${cls} photo"><img data-img="${esc(name)}" alt="">${c ? `<a class="credit" href="${esc(c.source)}" target="_blank" rel="noopener">© ${esc(c.author)} · ${esc(c.license)}</a>` : ''}</div>`;
}

function hydrateImages(root = document) {
  root.querySelectorAll('img[data-img]:not([src])').forEach(async (el) => {
    const url = await imageUrl(el.dataset.img);
    if (!url) { el.closest('.photo')?.classList.add('empty'); return; }
    el.onload = () => el.closest('.photo')?.classList.add('loaded');
    el.onerror = () => el.closest('.photo')?.classList.add('empty');
    el.src = url;
  });
}

const expImage = (e) => e.img || null;

/* ---------- small helpers ---------- */

const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
const mapsLink = (place) => {
  const q = place.address || place.name;
  if (place.lat && !place.address) return isApple ? `https://maps.apple.com/?ll=${place.lat},${place.lon}&q=${encodeURIComponent(place.name)}` : `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`;
  return isApple ? `https://maps.apple.com/?q=${encodeURIComponent(q)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};
const telHref = (p) => `tel:${p.replace(/[^+\d]/g, '')}`;

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

const statusTag = (s) => (s ? `<span class="status ${esc(s)}">${esc(STATUS[s] || s)}</span>` : '');

function expRow(e, { showStop = false, showDate = true } = {}) {
  const stop = stopById(e.stop);
  const when = e.date ? `${shortDate(e.date)}${e.meal ? ` · ${e.meal}` : ''}${e.time ? ` · ${e.time}` : ''}` : '';
  const img = expImage(e);
  return `<a class="row" href="#/exp/${esc(e.id)}">
    ${img ? photo(img, 'thumb') : ''}
    <div class="row-body">
      <p class="row-title">${esc(e.name)}</p>
      ${e.tagline ? `<p class="row-sub">${esc(e.tagline)}</p>` : ''}
      <div class="meta">${ic(e.kind)}${e.via ? `<span>On the way · ${esc(e.via)}</span>` : ''}${showStop && stop && !e.via ? `<span>${esc(stop.name)}</span>` : ''}${showDate && when ? `<span class="num">${esc(when)}</span>` : ''}${statusTag(e.status)}</div>
    </div>
    ${ic('chevron', 'chev')}
  </a>`;
}

/* ---------- views ---------- */

let coverPick = null;
function viewJourney() {
  const t = DATA.trip;
  const phase = tripPhase();
  const now = currentStop();
  const stops = DATA.stops;
  // During the trip, the chapter we are in; otherwise a photo drawn from all the chapters,
  // once each time the app opens, so it stays put while we browse.
  const pool = stops.map((s) => s.img).filter(Boolean);
  if (!coverPick || !pool.includes(coverPick)) coverPick = pool[Math.floor(Math.random() * pool.length)] || t.cover;
  const cover = (now && now.img) || coverPick;
  const [first, last] = [stops[0], stops[stops.length - 1]];

  let status = '';
  if (phase.phase === 'before') status = phase.days === 1 ? 'We leave tomorrow' : `${phase.days} days until we leave`;
  else if (phase.phase === 'during') status = `Day ${phase.day.n} of ${tripDays().length} · ${esc(phase.day.title)}`;
  else status = 'Home again. The journal remains.';

  const startD = parseDate(t.start);
  const endD = parseDate(t.end);

  // Up next: today's or the coming chapter; tables are the highlights of each day.
  const upcoming = phase.phase === 'during'
    ? (stopById(tripDays().find((d) => d.date > todayIso() && d.stop && d.stop !== phase.day.stop)?.stop) || now)
    : first;
  const tables = DATA.experiences.filter((e) => e.kind === 'cuisine' && e.date).sort((a, b) => a.date.localeCompare(b.date));

  return `<div class="page">
    <section class="cover">
      <p class="eyebrow">Europe · ${esc(t.edition || '')}</p>
      <h1 class="display">${esc(t.title)}</h1>
      <p class="lede">${esc(t.subtitle || '')}</p>
      <div class="cover-tools"><a class="icon-btn" href="#/practical" aria-label="Practical">${ic('practical', '')}</a></div>
    </section>
    ${photo(cover, 'cover-photo', { credit: true })}
    <a class="band" href="#/days">
      <div class="dates">
        <span class="d"><b class="num">${startD.getDate()}</b><span>${esc(fmt(t.start, { month: 'short' }))}</span></span>
        <span class="dash"></span>
        <span class="d"><b class="num">${endD.getDate()}</b><span>${esc(fmt(t.end, { month: 'short' }))}</span></span>
      </div>
      <div>
        <p class="h3">${esc(first?.name)} to ${esc(last?.name)}</p>
        <p class="italic">${stops.length} chapters · tables, art &amp; landscape</p>
      </div>
      ${ic('chevron', 'chev')}
    </a>
    <div class="map-frame">
      <a href="#/map" aria-label="Open the map">${routeMap(stops.map((s) => ({ ...s, now: now?.id === s.id })), { aspect: 0.8, home: t.home, widthPx: Math.min(innerWidth || 400, 640) })}</a>
      <a class="map-link" href="#/map">Open map</a>
    </div>
    <p class="status-line"><span class="eyebrow">${phase.phase === 'during' ? 'Today' : 'Departure'}</span><span class="meta">${status}</span></p>

    ${upcoming ? `<section class="section">
      <div class="section-head"><p class="eyebrow">${phase.phase === 'during' ? 'Up next' : 'First chapter'}</p></div>
      <a class="next" href="#/stop/${esc(upcoming.id)}">
        ${photo(upcoming.img)}
        <div class="row-body">
          <p class="h2">${esc(upcoming.name)}</p>
          <p class="meta num">${esc(range(upcoming.arrive, upcoming.depart))} · ${nights(upcoming)} night${nights(upcoming) === 1 ? '' : 's'}</p>
          <p class="row-sub">${esc(upcoming.tagline)}</p>
        </div>
        ${ic('chevron', 'chev')}
      </a>
    </section>` : ''}

    ${tables.length ? `<section class="section">
      <div class="section-head"><p class="eyebrow">The great tables</p><a href="#/experiences?k=cuisine">All</a></div>
      <div class="rows">${tables.map((e) => expRow(e, { showStop: true })).join('')}</div>
    </section>` : ''}

    <section class="section">
      <div class="section-head"><p class="eyebrow">The chapters</p><a href="#/days">Day by day</a></div>
      <ol class="rows">${stops.map((s) => `<li><a class="chapter${s.tentative ? ' tentative' : ''}" href="#/stop/${esc(s.id)}">
        <span class="numeral">${ROMAN[s.n] || s.n}</span>
        <span class="row-body">
          <span class="when num">${esc(range(s.arrive, s.depart))}${s.tentative ? ' · provisional' : ''}</span>
          <p class="row-title">${esc(s.name)}</p>
          <p class="row-sub">${esc(s.tagline)}</p>
        </span>
        ${photo(s.img, 'thumb sq')}
      </a></li>`).join('')}</ol>
    </section>

    ${essayLink()}
    <footer class="footer">${ORNAMENT}<p class="eyebrow"><a href="#/practical">Practical</a> &nbsp;·&nbsp; <a href="#/practical#credits">Photo credits</a></p></footer>
  </div>`;
}

function viewDays() {
  const days = tripDays();
  let lastStop = null;
  return `<div class="page">
    <section class="head plain-head">
      <p class="eyebrow ruled">${days.length} days</p>
      <h1 class="title">Day by day</h1>
      <p class="lede">${esc(range(DATA.trip.start, DATA.trip.end))}</p>
    </section>
    <section class="section"><div class="rows">${days.map((d) => {
      const stop = stopById(d.stop);
      const head = stop && stop.id !== lastStop ? `<p class="eyebrow" style="padding:22px 0 6px;color:var(--ochre)">${ROMAN[stop.n]} · ${esc(stop.name)}</p>`
        : !stop && lastStop && lastStop !== 'home' ? '<p class="eyebrow" style="padding:22px 0 6px;color:var(--ochre)">Homeward</p>' : '';
      lastStop = stop?.id || (lastStop ? 'home' : lastStop);
      const items = (d.plan || []).map(expById).filter(Boolean);
      // The whole day's driving: from the first leg's start to the last leg's end.
      const lg = d.legs || [];
      const drive = lg.length ? { from: lg[0].from, to: lg[lg.length - 1].to, hours: lg.every((l) => l.hours) ? lg.reduce((t, l) => t + l.hours, 0) : 0 } : null;
      return `${head}<a class="row" href="#/day/${d.date}">
        <div class="row-body">
          <span class="when meta num" style="margin:0">Day ${d.n} · ${esc(shortDate(d.date))}${d.tentative ? ' · provisional' : ''}</span>
          <p class="row-title">${esc(d.title)}</p>
          <div class="meta">${drive ? `<span>${ic('drive')}${esc(drive.from)} → ${esc(drive.to)}${drive.hours ? ` · ${hours(drive.hours)}` : ''}</span>` : ''}${items.filter((e) => e.kind === 'cuisine').map((e) => `<span>${ic('cuisine')}${esc(e.name)}</span>`).join('')}</div>
        </div>${ic('chevron', 'chev')}</a>`;
    }).join('')}</div></section>
  </div>`;
}

function viewStop(id) {
  const s = stopById(id);
  if (!s) return notFound();
  const days = tripDays().filter((d) => d.stop === s.id);
  const kinds = Object.keys(KIND).map((k) => ({ k, items: expsAt(s.id, k) }));
  return {
    title: s.name,
    html: `<div class="page">
    ${photo(s.img, 'hero', { credit: true })}
    <section class="head">
      <p class="eyebrow ruled">Chapter ${ROMAN[s.n] || s.n} · ${esc(range(s.arrive, s.depart))}${s.tentative ? ' · provisional' : ''}</p>
      <h1 class="title">${esc(s.name)}</h1>
      <p class="lede">${esc(s.tagline)}</p>
      <div class="prose">${paras(s.intro)}</div>
    </section>
    <div class="pad"><div class="kinds">${kinds.map(({ k, items }) => `<a class="kind${items.length ? '' : ' off'}" href="#/stop/${esc(s.id)}?k=${k}" data-jump="${k}"><i>${ic(k, '')}</i>${KIND[k].label}<small>${items.length || '—'}</small></a>`).join('')}</div></div>
    ${kinds.filter((x) => x.items.length).map(({ k, items }) => `<section class="section" id="sec-${k}">
      <div class="section-head"><p class="eyebrow">${KIND[k].section}</p></div>
      <div class="rows">${items.map((e) => expRow(e)).join('')}</div>
    </section>`).join('')}
    ${walksSection(s)}
    ${(() => {
      const p = (DATA.passages || []).find((x) => x.text && x.places?.includes(s.id));
      return p ? `<section class="section">
      <div class="section-head"><p class="eyebrow">On the page</p><a href="#/reading?s=${esc(s.id)}">More passages</a></div>
      ${passageHtml(p)}
    </section>` : '';
    })()}
    <section class="section">
      <div class="section-head"><p class="eyebrow">Where we stay</p></div>
      ${s.stay ? `<div class="row"><div class="row-body"><p class="row-title">${esc(s.stay.name)}</p><p class="meta">${esc(s.stay.address || '')}</p></div></div>`
        : `<p class="tbd">To be booked · ${nights(s)} night${nights(s) === 1 ? '' : 's'}</p>`}
    </section>
    <section class="section">
      <div class="section-head"><p class="eyebrow">The days</p></div>
      <div class="rows">${days.map((d) => `<a class="row" href="#/day/${d.date}"><div class="row-body"><span class="when meta num" style="margin:0">Day ${d.n} · ${esc(shortDate(d.date))}</span><p class="row-title">${esc(d.title)}</p></div>${ic('chevron', 'chev')}</a>`).join('')}</div>
    </section>
    <div class="actions"><a class="btn wide" href="${esc(mapsLink(s))}" target="_blank" rel="noopener">${ic('directions', '')}Directions</a></div>
  </div>`,
  };
}

/* ---------- walks ---------- */

const walksAt = (stopId) => (DATA.walks || []).filter((w) => w.stop === stopId).sort((a, b) => a.n - b.n);
const walkById = (id) => (DATA.walks || []).find((w) => w.id === id);
let walkMaps = null; // loaded with the first map: map.js brings Leaflet
const walkColour = (w) => (walkMaps?.WALK_COLOURS || ['#AD7954', '#5E6052', '#292D26'])[(w.n - 1) % 4];
const km = (w) => {
  // Same estimate as map.js: straight lines plus a quarter, rounded to half a kilometre.
  const r = (x) => (x * Math.PI) / 180;
  let m = 0;
  w.points.forEach((p, i) => {
    if (!i || p.ride) return;
    const a = w.points[i - 1];
    const h = Math.sin(r(p.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(p.lat)) * Math.sin(r(p.lon - a.lon) / 2) ** 2;
    m += 6371000 * 2 * Math.asin(Math.sqrt(h));
  });
  return Math.max(0.5, Math.round((m * 1.25) / 500) / 2);
};
const kmText = (w) => `about ${km(w)} km`;

function walksSection(s) {
  const walks = walksAt(s.id);
  if (!walks.length) return '';
  const src = walks[0].source;
  return `<section class="section walks">
      <div class="section-head"><p class="eyebrow">On foot</p>${src ? `<span class="meta">After ${esc(src.author)}, ${esc(src.publication)}</span>` : ''}</div>
      <div class="walkmap mini" id="walks-overview" role="img" aria-label="Map of the ${walks.length} walks"></div>
      <div class="rows">${walks.map((w) => `<a class="row walk-row" href="#/walk/${esc(w.id)}"><span class="walk-key" style="--c:${walkColour(w)}">${ROMAN[w.n] || w.n}</span><div class="row-body"><p class="row-title">${esc(w.title)}</p><p class="row-sub">${esc(w.where)} · ${w.points.length} stops · ${kmText(w)}</p></div>${ic('chevron', 'chev')}</a>`).join('')}</div>
    </section>`;
}

function viewWalk(id) {
  const w = walkById(id);
  if (!w) return notFound();
  const s = stopById(w.stop);
  const others = walksAt(w.stop);
  const i = others.indexOf(w);
  const prev = others[i - 1];
  const next = others[i + 1];
  const src = w.source;
  const g = (p) => `${p.lat},${p.lon}`;
  const legs = w.points.slice(Math.max(0, w.points.findIndex((p) => p.ride))); // on foot from where the bus stops
  const mid = legs.slice(1, -1);
  const pick = mid.filter((_, k) => mid.length <= 8 || k % Math.ceil(mid.length / 8) === 0).slice(0, 8);
  const gmaps = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${g(legs[0])}&destination=${g(legs[legs.length - 1])}${pick.length ? `&waypoints=${pick.map(g).join('%7C')}` : ''}`;
  return {
    title: `Walk ${ROMAN[w.n] || w.n}`,
    html: `<div class="page walk" style="--c:${walkColour(w)}">
    <section class="head">
      <p class="eyebrow ruled">${esc(s?.name || '')} · Walk ${ROMAN[w.n] || w.n} of ${others.length}</p>
      <h1 class="title">${esc(w.title)}</h1>
      <p class="lede">${esc(w.where)}</p>
      <p class="meta walk-facts">${w.points.length} stops · ${kmText(w)} on foot${w.how ? ` · ${esc(w.how)}` : ''}</p>
      <div class="prose"><p>${esc(w.intro)}</p></div>
    </section>
    <div class="walkmap" id="walk-map" role="img" aria-label="Map of the walk"></div>
    <ol class="walk-stops">${w.points.map((p, k) => {
      const e = p.exp ? expById(p.exp) : null;
      return `<li id="walkstop-${k}" class="walk-stop${p.ride ? ' ride' : ''}">
        <button type="button" class="walk-num" data-focus="${k}" aria-label="Show stop ${k + 1} on the map">${k + 1}</button>
        <div class="walk-body">
          ${p.ride ? '<p class="eyebrow">By bus</p>' : ''}
          <p class="row-title">${esc(p.name)}</p>
          ${p.by ? `<p class="meta">${esc(p.by)}</p>` : ''}
          <p class="walk-note">${esc(p.note)}</p>
          ${e ? `<a class="more" href="#/exp/${esc(e.id)}">${esc(e.name)} in our plans ${ic('chevron', 'chev')}</a>` : ''}
        </div>
      </li>`;
    }).join('')}</ol>
    <div class="actions"><a class="btn wide" href="${esc(gmaps)}" target="_blank" rel="noopener">${ic('directions', '')}Walking route in Google Maps</a></div>
    ${src ? `<p class="source pad meta">After “<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title)}</a>” by ${esc(src.author)}, ${esc(src.publication)}, ${esc(fmt(src.date, { day: 'numeric', month: 'long', year: 'numeric' }))}. Notes in our own words; positions approximate.</p>` : ''}
    <nav class="daynav pad">${prev ? `<a href="#/walk/${esc(prev.id)}">← Walk ${ROMAN[prev.n]}</a>` : `<a href="#/stop/${esc(w.stop)}">← ${esc(s?.name || '')}</a>`}${next ? `<a href="#/walk/${esc(next.id)}">Walk ${ROMAN[next.n]} →</a>` : `<a href="#/stop/${esc(w.stop)}">${esc(s?.name || '')} →</a>`}</nav>
  </div>`,
  };
}

async function bindWalks(route) {
  const el = $(route === 'walk' ? '#walk-map' : '#walks-overview');
  if (!el) return;
  try {
    walkMaps = await import('./map.js');
    if (!el.isConnected) return;
    if (route === 'stop') {
      const stopId = location.hash.split('/')[2]?.split('?')[0];
      await walkMaps.drawWalksOverview(el, walksAt(stopId), { roman: (n) => ROMAN[n] || n, onPick: (id) => { location.hash = `#/walk/${id}`; } });
    } else {
      const w = walkById(location.hash.split('/')[2]?.split('?')[0]);
      const m = await walkMaps.drawWalk(el, w, { colour: walkColour(w) });
      document.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        m.focus(+b.dataset.focus);
      }));
    }
  } catch {
    el.classList.add('offline');
    el.innerHTML = '<p class="meta">The map needs a connection the first time.</p>';
  }
}

function viewExperience(id) {
  const e = expById(id);
  if (!e) return notFound();
  const stop = stopById(e.stop);
  const facts = [];
  if (e.date) facts.push(['When', `<span class="num">${esc(longDate(e.date))}${e.meal ? ` · ${esc(e.meal)}` : ''}${e.time ? ` · ${esc(e.time)}` : ''}</span>`]);
  if (e.chef) facts.push(['Chef', esc(e.chef)]);
  if (e.distinction) facts.push(['Guide', esc(e.distinction)]);
  if (e.address) facts.push(['Address', `<a href="${esc(mapsLink(e))}" target="_blank" rel="noopener">${esc(e.address)}</a>`]);
  if (e.phone) facts.push(['Phone', `<a href="${telHref(e.phone)}">${esc(e.phone)}</a>`]);
  if (e.booking) facts.push(['Booking', esc([e.booking.ref, e.booking.for].filter(Boolean).join(' · '))]);
  if (e.kind === 'cuisine' && !e.booking) facts.push(['Booking', '<span class="tbd">Not yet booked</span>']);
  const notes = journal().filter((n) => n.exp === e.id);
  return {
    title: e.name,
    html: `<div class="page">
    ${photo(expImage(e) || stop?.img, 'hero', { credit: true })}
    <section class="head">
      <p class="eyebrow ruled">${esc(KIND[e.kind]?.label)} · ${esc(stop?.name || '')}</p>
      <h1 class="title">${esc(e.name)}</h1>
      ${e.tagline ? `<p class="lede">${esc(e.tagline)}</p>` : ''}
      <p style="margin-top:14px">${statusTag(e.status)}</p>
      <div class="prose">${paras(e.about)}</div>
    </section>
    ${facts.length ? `<section class="section"><dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>` : ''}
    ${e.note ? `<section class="section"><div class="section-head"><p class="eyebrow">Note</p></div><p class="prose">${esc(e.note)}</p></section>` : ''}
    ${e.highlights?.length ? `<section class="section"><div class="section-head"><p class="eyebrow">${e.kind === 'cuisine' ? 'On the menu' : 'Not to miss'}</p></div><ul class="list-dash">${e.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></section>` : ''}
    <section class="section">
      <div class="section-head"><p class="eyebrow">Our impressions</p><a href="#/journal?exp=${esc(e.id)}${e.date ? `&day=${e.date}` : ''}">Write</a></div>
      ${notes.length ? notes.map(entryHtml).join('') : `<p class="tbd">${e.status === 'visited' ? 'Nothing written yet.' : 'After the visit: what we ate, what we saw, what stayed with us.'}</p>`}
    </section>
    <div class="actions">
      ${e.lat || e.address ? `<a class="btn wide" href="${esc(mapsLink(e))}" target="_blank" rel="noopener">${ic('directions', '')}Directions</a>` : ''}
      ${e.phone ? `<a class="btn ghost" href="${telHref(e.phone)}">${ic('phone', '')}Call</a>` : ''}
      ${e.web ? `<a class="btn ghost" href="${esc(e.web)}" target="_blank" rel="noopener">${ic('web', '')}Website</a>` : ''}
    </div>
  </div>`,
  };
}

function viewDay(date) {
  const days = tripDays();
  const i = days.findIndex((d) => d.date === date);
  if (i < 0) return notFound();
  const d = days[i];
  const stop = stopById(d.stop);
  const prev = days[i - 1];
  const next = days[i + 1];
  const items = [];
  for (const leg of d.legs || []) {
    items.push(`<li class="tl drive"><span class="t">${esc(leg.depart || '')}</span><span class="dot"></span><div>
      <p class="row-title">${esc(leg.from)} → ${esc(leg.to)}</p>
      <p class="row-sub">${[leg.km ? `${leg.km} km` : '', leg.hours ? `about ${hours(leg.hours)}` : '', leg.via ? `via ${leg.via}` : ''].filter(Boolean).join(' · ') || 'Route to be planned'}</p>
    </div></li>`);
  }
  for (const id of d.plan || []) {
    const e = expById(id);
    if (!e) continue;
    items.push(`<li class="tl ${esc(e.kind)}"><span class="t">${esc(e.time || (e.meal ? e.meal.slice(0, 5) : ''))}</span><span class="dot"></span><a href="#/exp/${esc(e.id)}">
      <p class="row-title">${esc(e.name)}</p>
      ${e.tagline ? `<p class="row-sub">${esc(e.tagline)}</p>` : ''}
      <div class="meta">${ic(e.kind)}${statusTag(e.status)}</div>
    </a></li>`);
  }
  if (d.night) {
    items.push(`<li class="tl stay"><span class="t">Night</span><span class="dot"></span><div>
      <p class="row-title">${esc(d.night)}</p>
      <p class="row-sub">Hotel to be booked · on the way home</p>
    </div></li>`);
  } else if (stop && d.date < stop.depart) {
    items.push(`<li class="tl stay"><span class="t">Night</span><span class="dot"></span><div>
      <p class="row-title">${esc(stop.stay?.name || `${stop.name}`)}</p>
      <p class="row-sub">${stop.stay ? esc(stop.stay.address || '') : 'Hotel to be booked'}</p>
    </div></li>`);
  }
  const notes = journal().filter((n) => n.day === d.date);
  return {
    title: `Day ${d.n}`,
    html: `<div class="page">
    <section class="head plain-head">
      <p class="eyebrow ruled">Day ${d.n} · ${esc(longDate(d.date))}</p>
      <h1 class="title">${esc(d.title)}</h1>
      ${stop ? `<p class="lede"><a href="#/stop/${esc(stop.id)}">Chapter ${ROMAN[stop.n]} · ${esc(stop.name)}</a>${d.tentative ? ' · provisional' : ''}</p>` : ''}
    </section>
    <nav class="daynav">
      <a class="${prev ? '' : 'off'}" href="#/day/${prev?.date || ''}">‹ ${prev ? esc(shortDate(prev.date)) : ''}</a>
      <a class="${next ? '' : 'off'}" href="#/day/${next?.date || ''}">${next ? esc(shortDate(next.date)) : ''} ›</a>
    </nav>
    <section class="section">
      ${items.length ? `<ol class="timeline">${items.join('')}</ol>` : '<p class="tbd">A free day, for now.</p>'}
    </section>
    ${d.note ? `<section class="section"><div class="prose">${paras(d.note)}</div></section>` : ''}
    <section class="section">
      <div class="section-head"><p class="eyebrow">Journal</p><a href="#/journal?day=${d.date}">Write</a></div>
      ${notes.length ? notes.map(entryHtml).join('') : '<p class="tbd">Nothing written for this day yet.</p>'}
    </section>
  </div>`,
  };
}

function viewExperiences(params) {
  const k = params.get('k') || 'all';
  const list = DATA.experiences.filter((e) => k === 'all' || e.kind === k);
  return `<div class="page">
    <section class="head plain-head">
      <p class="eyebrow ruled">${DATA.experiences.length} experiences</p>
      <h1 class="title">Experiences</h1>
      <p class="lede">What we'd like to taste, see and walk.</p>
    </section>
    <div class="seg" role="group" aria-label="Filter">${[['all', 'All'], ...Object.entries(KIND).map(([key, v]) => [key, v.label])].map(([key, label]) => `<button data-k="${key}" aria-pressed="${k === key}">${label}</button>`).join('')}</div>
    ${DATA.stops.map((s) => {
      const items = list.filter((e) => e.stop === s.id);
      if (!items.length) return '';
      return `<section class="section"><div class="section-head"><p class="eyebrow">${ROMAN[s.n]} · ${esc(s.name)}</p><span class="meta num">${esc(range(s.arrive, s.depart))}</span></div>
        <div class="rows">${items.map((e) => expRow(e)).join('')}</div></section>`;
    }).join('') || '<div class="empty-state"><p class="lede">Nothing here yet.</p></div>'}
    ${(() => {
      const home = list.filter((e) => !e.stop);
      return home.length ? `<section class="section"><div class="section-head"><p class="eyebrow">On the road</p></div>
        <div class="rows">${home.map((e) => expRow(e)).join('')}</div></section>` : '';
    })()}
  </div>`;
}

/* ---------- journal: notes and photos, shared between both phones (notes.js) ---------- */

const journal = () => (NOTES ? NOTES.list() : []).filter((n) => n.day).sort((a, b) => (a.day + a.created).localeCompare(b.day + b.created));
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const me = () => store.get('me', DATA.trip.travellers?.[0] || '');

// Photos added on a phone live in IndexedDB; the other phone downloads them once.
const photoUrls = new Map();
function hydratePhotos(root = document) {
  root.querySelectorAll('img[data-ph]:not([src])').forEach(async (el) => {
    const id = el.dataset.ph;
    if (!photoUrls.has(id)) photoUrls.set(id, NOTES.photo(id).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
    const url = await photoUrls.get(id);
    if (!url) { photoUrls.delete(id); el.closest('.photo')?.classList.add('empty'); return; }
    el.onload = () => el.closest('.photo')?.classList.add('loaded');
    el.src = url;
  });
}

function entryHtml(n) {
  const e = n.exp && expById(n.exp);
  const ratio = n.w && n.h ? `aspect-ratio:${n.w}/${n.h}` : 'aspect-ratio:4/3';
  return `<article class="entry">
    <p class="by">${esc(n.author)} · <button class="entry-day" data-move="${esc(n.id)}" aria-label="Change the day">${esc(shortDate(n.day))}</button>${e ? ` · <a href="#/exp/${esc(e.id)}">${esc(e.name)}</a>` : ''}
      <button class="entry-del" data-del="${esc(n.id)}" aria-label="Remove">Remove</button></p>
    ${n.type === 'photo' ? `<figure class="jphoto"><div class="photo" style="${ratio}"><img data-ph="${esc(n.id)}" alt=""></div>${n.caption ? `<figcaption>${esc(n.caption)}</figcaption>` : ''}</figure>` : ''}
    ${n.text ? `<div class="prose">${paras(n.text)}</div>` : ''}
  </article>`;
}

// Every day of the trip, for attributing an entry or photo to a day other than today.
const dayOptions = (selected) => tripDays().map((d) => `<option value="${d.date}"${d.date === selected ? ' selected' : ''}>Day ${d.n} · ${esc(longDate(d.date))}</option>`).join('');

function syncLine() {
  if (!NOTES) return '';
  const st = NOTES.status();
  return `<p class="sync sync-${st.kind}"><span>${esc(st.text)}</span>${NOTES.enabled ? '<button type="button" data-sync>Sync now</button>' : ''}</p>`;
}

function viewJournal(params) {
  const days = tripDays();
  const t = todayIso();
  const day = params.get('day') || (days.find((d) => d.date === t) || days[0]).date;
  const exp = params.get('exp') || '';
  const who = me();
  const entries = journal();
  const byDay = days.map((d) => ({ d, items: entries.filter((n) => n.day === d.date) })).filter((x) => x.items.length);
  return `<div class="page">
    <section class="head plain-head">
      <p class="eyebrow ruled">${esc((DATA.trip.travellers || []).join(' & '))}</p>
      <h1 class="title">Journal</h1>
      <p class="lede">Small observations become subtle memories.</p>
    </section>
    <section class="section">
      <form class="composer" id="composer">
        <div class="who">${(DATA.trip.travellers || []).map((p) => `<button type="button" class="chip" data-who="${esc(p)}" aria-pressed="${p === who}">${esc(p)}</button>`).join('')}</div>
        <label class="day-pick"><span class="eyebrow">For</span>
          <select id="j-day">${dayOptions(day)}</select>${ic('chevron', 'chev down')}</label>
        ${exp ? `<input type="hidden" id="j-exp" value="${esc(exp)}"><p class="meta" style="margin-top:10px">About: ${esc(expById(exp)?.name || '')}</p>` : ''}
        <textarea id="j-text" placeholder="What stayed with us today…" rows="4">${esc(draft)}</textarea>
        <div class="actions" style="padding:14px 0 0">
          <button class="btn wide" type="submit">${ic('pen', '')}Add to the journal</button>
          <label class="btn ghost">${ic('camera', '')}Photos<input id="j-photos" type="file" accept="image/*" multiple hidden></label>
        </div>
      </form>
      ${syncLine()}
    </section>
    ${byDay.length ? byDay.map(({ d, items }) => `<section class="section">
      <div class="section-head"><p class="eyebrow">Day ${d.n} · ${esc(shortDate(d.date))}</p><a href="#/day/${d.date}">${esc(stopById(d.stop)?.name || 'Day')}</a></div>
      ${items.map(entryHtml).join('')}
    </section>`).join('') : `<div class="empty-state">${ORNAMENT}<p class="h2">The journal begins on ${esc(fmt(DATA.trip.start, { day: 'numeric', month: 'long' }))}</p><p class="lede">Each day gathers the notes and photographs you both add.</p></div>`}
  </div>`;
}

// A passage: the words themselves, or (for books under copyright) a pointer to
// where we'll find them in our own copies.
const LONG = 520;
function passageHtml(p, { open = false } = {}) {
  if (!p.text) {
    return `<article class="passage find">
      <p class="eyebrow">${esc(p.author)} · <span class="italic">${esc(p.source)}</span></p>
      ${p.cue ? `<p class="find-cue" lang="${esc(p.lang || 'en')}">“${esc(p.cue)}${/[.!?»]$/.test(p.cue) ? '' : '…'}”</p>` : ''}
      <p class="find-note">${esc(p.find)}${p.web ? ` <a href="${esc(p.web)}" target="_blank" rel="noopener">Open</a>` : ''}</p>
      ${p.where ? `<p class="meta find-where">${esc(p.where)}</p>` : ''}
    </article>`;
  }
  const long = p.text.length > LONG && !open;
  return `<article class="passage" lang="${esc(p.lang || 'en')}">
    <blockquote class="${long ? 'clipped' : ''}">${paras(p.text)}</blockquote>
    ${p.translation ? `<div class="translation"${long ? ' hidden' : ''} lang="en"><p class="eyebrow">In English</p><blockquote>${paras(p.translation)}</blockquote></div>` : ''}
    ${long ? '<button class="read-on" type="button" data-readon>Read on</button>' : ''}
    <p class="cite"><span class="who">${esc(p.author)}</span> · <span class="italic">${esc(p.source)}</span>${p.where ? `<br><span class="meta">${esc(p.where)}</span>` : ''}</p>
  </article>`;
}

// The essay on the winter Grand Tour: a one-time read, so only a quiet link to it.
function essayLink() {
  const e = DATA.essay;
  if (!e) return '';
  return `<a class="aside-link" href="#/essay"><span class="row-body"><span class="eyebrow">${esc(e.eyebrow || 'An essay')}</span><span class="italic">${esc(e.link || e.title)}</span></span>${ic('chevron', 'chev')}</a>`;
}

function viewEssay() {
  const e = DATA.essay;
  if (!e) return '<div class="page"><div class="empty-state">' + ORNAMENT + '<p class="h2">Nothing here yet</p></div></div>';
  const body = e.text.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\*(.+?)\*/g, '<em>$1</em>')}</p>`).join('');
  return `<div class="page">
    <section class="head plain-head">
      <p class="eyebrow ruled">${esc(e.eyebrow || 'An essay')}</p>
      <h1 class="title">${esc(e.title)}</h1>
    </section>
    <article class="essay prose">${body}</article>
    <footer class="footer">${ORNAMENT}<p class="eyebrow"><a href="#/">Journey</a> &nbsp;·&nbsp; <a href="#/reading">Reading</a></p></footer>
  </div>`;
}

function viewReading(params) {
  const all = DATA.passages || [];
  if (!all.length) {
    return `<div class="page"><section class="head plain-head"><p class="eyebrow ruled">A literary companion</p><h1 class="title">Reading</h1></section>
      <div class="empty-state">${ORNAMENT}<p class="h2">No passages yet</p></div></div>`;
  }
  const at = params.get('s') || 'all';
  const stops = DATA.stops.filter((s) => all.some((p) => p.places?.includes(s.id)));
  const shown = stops.filter((s) => at === 'all' || s.id === at);
  const quotes = all.filter((p) => p.text).length;
  return `<div class="page">
    <section class="head plain-head">
      <p class="eyebrow ruled">${quotes} passages</p>
      <h1 class="title">Reading</h1>
      <p class="lede">Passages for the road, gathered by place.</p>
    </section>
    ${essayLink()}
    <div class="seg" role="group" aria-label="Chapter">${[['all', 'All'], ...stops.map((s) => [s.id, s.name])].map(([key, label]) => `<button data-s="${esc(key)}" aria-pressed="${at === key}">${esc(label)}</button>`).join('')}</div>
    ${shown.map((s) => {
      const here = all.filter((p) => p.places?.includes(s.id));
      const block = (list) => {
        const words = list.filter((p) => p.text);
        const finds = list.filter((p) => !p.text);
        return `${words.map((p) => passageHtml(p)).join('')}
          ${finds.length ? `<p class="eyebrow find-head">In our own books</p>${finds.map((p) => passageHtml(p)).join('')}` : ''}`;
      };
      // A chapter with many day trips is read town by town.
      const towns = (s.towns || []).filter((t) => here.some((p) => p.town === t));
      const rest = here.filter((p) => !towns.includes(p.town));
      return `<section class="section">
        <div class="section-head"><p class="eyebrow">${ROMAN[s.n]} · ${esc(s.name)}</p><a href="#/stop/${esc(s.id)}">Chapter</a></div>
        ${towns.length ? `<nav class="town-index">${towns.map((t, i) => `<button type="button" data-jump="town-${esc(s.id)}-${i}">${esc(t)}</button>`).join('')}</nav>` : ''}
        ${rest.length ? block(rest) : ''}
        ${towns.map((t, i) => `<div class="town" id="town-${esc(s.id)}-${i}">
          <h3 class="town-head">${esc(t)} <span class="meta num">${here.filter((p) => p.town === t).length}</span></h3>
          ${block(here.filter((p) => p.town === t))}
        </div>`).join('')}
      </section>`;
    }).join('')}
    <footer class="footer">${ORNAMENT}<p class="meta">Passages are from public-domain editions. Books still under copyright are listed as pointers.</p></footer>
  </div>`;
}

function viewPractical() {
  const booked = DATA.experiences.filter((e) => ['booked', 'planned', 'tbc'].includes(e.status) && e.date).sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="page">
    <section class="head plain-head">
      <p class="eyebrow ruled">Practical</p>
      <h1 class="title">Bookings & help</h1>
    </section>
    <section class="section">
      <div class="section-head"><p class="eyebrow">Where we sleep</p></div>
      <div class="rows">${DATA.stops.map((s) => `<a class="row" href="#/stop/${esc(s.id)}"><div class="row-body"><span class="when meta num" style="margin:0">${esc(range(s.arrive, s.depart))} · ${nights(s)} night${nights(s) === 1 ? '' : 's'}</span><p class="row-title">${esc(s.stay?.name || s.name)}</p>${s.stay ? '' : '<p class="row-sub">To be booked</p>'}</div>${ic('chevron', 'chev')}</a>`).join('')}</div>
    </section>
    <section class="section">
      <div class="section-head"><p class="eyebrow">Reservations</p></div>
      <div class="rows">${booked.map((e) => expRow(e, { showStop: true })).join('')}</div>
    </section>
    <section class="section">
      <div class="section-head"><p class="eyebrow">Emergency</p></div>
      <dl class="facts">${(DATA.emergency || []).map((c) => `<dt>${esc(c.country)}</dt><dd>${c.numbers.map((n) => `<a href="tel:${esc(n.tel)}">${esc(n.tel)}</a> <span class="meta">${esc(n.label)}</span>`).join('<br>')}</dd>`).join('')}</dl>
    </section>
    <section class="section" id="credits">
      <div class="section-head"><p class="eyebrow">Photo credits</p></div>
      <ul class="list-dash" style="font-size:15px">${Object.entries(DATA.credits || {}).map(([k, c]) => `<li>${esc(stopById(k)?.name || k)}: <a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(c.author)}</a>, ${esc(c.license)}, via Wikimedia Commons</li>`).join('')}</ul>
    </section>
  </div>`;
}

function notFound() {
  return { title: '', html: '<div class="page"><section class="head plain-head"><h1 class="title">Not found</h1><p class="lede"><a href="#/">Back to the journey</a></p></section></div>' };
}

/* ---------- map tab ---------- */

async function viewMap(el) {
  el.innerHTML = '<div class="mapview" id="mapview"><div class="map-title"><div class="card"><p class="eyebrow">The route</p><p class="h3">' + esc(DATA.stops.map((s) => s.name).join(' · ')) + '</p></div></div></div>';
  const { drawMap } = await import('./map.js');
  drawMap($('#mapview'), DATA, { kindLabel: (k) => KIND[k]?.label || k, statusLabel: (s) => STATUS[s] || s });
}

/* ---------- router ---------- */

const TABS = { '': 'journey', days: 'journey', stop: 'journey', day: 'journey', exp: 'experiences', experiences: 'experiences', map: 'map', journal: 'journal', reading: 'reading', practical: 'journey', essay: 'journey', walk: 'journey' };

async function render() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [route, arg] = path.split('/');
  const params = new URLSearchParams(query);
  const view = $('#view');
  const bar = $('#bar');
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === TABS[route]));

  if (route === 'map') {
    bar.hidden = true;
    await viewMap(view);
    return;
  }

  let out;
  switch (route) {
    case '': out = viewJourney(); break;
    case 'days': out = { title: 'Day by day', html: viewDays() }; break;
    case 'stop': out = viewStop(arg); break;
    case 'exp': out = viewExperience(arg); break;
    case 'day': out = viewDay(arg); break;
    case 'experiences': out = viewExperiences(params); break;
    case 'journal': out = viewJournal(params); break;
    case 'reading': out = viewReading(params); break;
    case 'practical': out = { title: 'Practical', html: viewPractical() }; break;
    case 'essay': out = { title: 'An essay', html: viewEssay() }; break;
    case 'walk': out = viewWalk(arg); break;
    default: out = notFound();
  }
  const detail = typeof out === 'object';
  view.innerHTML = detail ? out.html : out;
  bar.hidden = !detail;
  bar.classList.remove('solid');
  $('#bar-title').textContent = detail ? out.title : '';
  hydrateImages(view);
  hydratePhotos(view);
  bind(route, params);

  const anchor = location.hash.split('#')[2];
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else window.scrollTo(0, 0);
  if (route === 'stop' && params.get('k')) document.getElementById(`sec-${params.get('k')}`)?.scrollIntoView({ block: 'start' });
}

function bind(route, params) {
  if (route === 'stop' || route === 'walk') bindWalks(route);
  if (route === 'reading') {
    document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
      location.replace(`#/reading${b.dataset.s === 'all' ? '' : `?s=${b.dataset.s}`}`);
    }));
  }
  if (route === 'experiences') {
    document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
      location.replace(`#/experiences${b.dataset.k === 'all' ? '' : `?k=${b.dataset.k}`}`);
    }));
  }
  if (route === 'journal') {
    document.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => {
      store.set('me', b.dataset.who);
      document.querySelectorAll('[data-who]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    }));
    $('#j-text').addEventListener('input', (ev) => { draft = ev.target.value; });
    $('#composer').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const text = $('#j-text').value.trim();
      if (!text) return;
      draft = '';
      NOTES.save({ id: newId(), type: 'note', day: $('#j-day').value, exp: $('#j-exp')?.value || null, author: me(), text });
      toast('Added to the journal');
    });
    $('#j-photos').addEventListener('change', (ev) => addPhotos(ev.target));
  }
}

async function addPhotos(input) {
  const files = [...input.files];
  if (!files.length) return;
  const day = $('#j-day').value;
  const exp = $('#j-exp')?.value || null;
  const caption = $('#j-text').value.trim();
  toast(files.length === 1 ? 'Adding the photo…' : `Adding ${files.length} photos…`);
  let first = true;
  for (const file of files) {
    try {
      const { blob, w, h } = await preparePhoto(file);
      const id = newId();
      await media.put(id, blob);
      // Text typed in the box becomes the caption of the first photo.
      NOTES.save({ id, type: 'photo', day, exp, author: me(), caption: first ? caption : '', w, h });
      first = false;
    } catch {
      toast('One photo could not be read');
    }
  }
  if (caption) draft = '';
  input.value = '';
}

// Clicks that work on every page: removing an entry, syncing by hand.
document.addEventListener('click', (ev) => {
  const del = ev.target.closest('[data-del]');
  if (del) {
    if (confirm('Remove this entry? It disappears on both phones.')) NOTES.remove(del.dataset.del);
    return;
  }
  const move = ev.target.closest('[data-move]');
  if (move) {
    const n = NOTES.list().find((x) => x.id === move.dataset.move);
    if (!n) return;
    const sel = document.createElement('select');
    sel.className = 'entry-day-select';
    sel.setAttribute('aria-label', 'Move to day');
    sel.innerHTML = dayOptions(n.day);
    move.replaceWith(sel);
    sel.focus();
    sel.addEventListener('change', () => { NOTES.save({ ...n, day: sel.value }); toast(`Moved to ${shortDate(sel.value)}`); });
    sel.addEventListener('blur', () => { if (sel.value === n.day) onNotesChange(); });
    return;
  }
  const jump = ev.target.closest('[data-jump]');
  if (jump) { document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const more = ev.target.closest('[data-readon]');
  if (more) {
    const art = more.closest('.passage');
    art.querySelector('blockquote.clipped')?.classList.remove('clipped');
    art.querySelector('.translation')?.removeAttribute('hidden');
    more.remove();
    return;
  }
  if (ev.target.closest('[data-sync]')) NOTES.syncNow().then(() => toast(NOTES.status().text));
});

// Entries changed (saved here or arrived from the other phone): redraw the pages that
// show them, keeping the scroll position and any half-typed text.
function onNotesChange() {
  const route = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  if (!['journal', 'day', 'exp'].includes(route)) return;
  const y = window.scrollY;
  render().then(() => window.scrollTo(0, y));
}

// The back button returns where you came from, or up to the journey.
let depth = 0;
$('#back').addEventListener('click', (e) => {
  if (depth > 0) { e.preventDefault(); depth -= 2; history.back(); }
});
window.addEventListener('hashchange', () => { depth++; render(); });
window.addEventListener('scroll', () => {
  const hero = $('.hero');
  const limit = hero ? hero.offsetHeight - 60 : 40;
  $('#bar').classList.toggle('solid', window.scrollY > limit);
}, { passive: true });

/* ---------- start ---------- */

async function show() {
  KEY = DATA.contentKey ? await importContentKey(DATA.contentKey) : null;
  // A sync token stored on this device (for testing) wins over the one in the trip data.
  const sync = store.get('sync') || DATA.sync || null;
  NOTES = KEY ? createNotes({ key: KEY, sync, store, onChange: onNotesChange }) : null;
  $('#lock').hidden = true;
  $('#view').hidden = false;
  $('#tabs').hidden = false;
  render();
  if (NOTES) {
    NOTES.syncNow();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) NOTES.syncNow(); });
    window.addEventListener('online', () => NOTES.syncNow());
    setInterval(() => { if (!document.hidden) NOTES.syncNow(); }, 60000);
  }
}

async function unlock(pass) {
  const box = await fetch('data/trip.enc.json', { cache: 'no-cache' }).then((r) => r.json());
  DATA = await decryptJSON(box, pass);
  store.set('pass', pass);
}

async function start() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local) {
    // Local design work: read the plaintext trip from private/ (never published).
    const plain = await fetch('private/trip.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (plain) { DATA = plain; DEV = true; show(); return; }
  }
  const saved = store.get('pass');
  if (saved) {
    try { await unlock(saved); show(); return; } catch { /* fall through to the lock screen */ }
  }
  $('#lock').hidden = false;
  $('#lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#lock-msg').textContent = '';
    try { await unlock($('#pass').value); show(); } catch { $('#lock-msg').textContent = 'That passphrase does not open the journal.'; }
  });
}

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
