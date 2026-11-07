#!/usr/bin/env python3
"""Encrypts private/ into data/ (committed), or decrypts it back.

    TRIP_PASSPHRASE='...' python3 tools/vault.py encrypt
    TRIP_PASSPHRASE='...' python3 tools/vault.py decrypt

private/trip.json  -> data/trip.enc.json  (passphrase: PBKDF2-SHA256 + AES-256-GCM)
private/img/*.jpg  -> data/img/<id>.bin   (content key stored inside the trip data)

Same format as crypto.js, so the app decrypts it in the browser. Image ids are a
hash of key and content: published file names reveal nothing and unchanged photos
are not rewritten. private/ is git-ignored.

Needs the `cryptography` package: python3 -m venv .venv && .venv/bin/pip install cryptography
"""
import base64, hashlib, json, os, sys, unicodedata
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
PLAIN, PLAIN_IMG = ROOT / 'private' / 'trip.json', ROOT / 'private' / 'img'
BOX, BOX_IMG = ROOT / 'data' / 'trip.enc.json', ROOT / 'data' / 'img'
ITERATIONS = 310000

b64 = lambda b: base64.b64encode(b).decode()
unb64 = base64.b64decode


def normalize(p):
    # Same as normalizePass in crypto.js: iPhones capitalise and add trailing spaces.
    return unicodedata.normalize('NFC', p).strip().lower()


def derive(passphrase, salt, iterations):
    return hashlib.pbkdf2_hmac('sha256', normalize(passphrase).encode(), salt, iterations, 32)


def encrypt_json(obj, passphrase):
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(derive(passphrase, salt, ITERATIONS)).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode(), None)
    return {'v': 1, 'kdf': 'PBKDF2-SHA256', 'iterations': ITERATIONS, 'salt': b64(salt), 'iv': b64(iv), 'data': b64(ct)}


def decrypt_json(box, passphrase):
    key = derive(passphrase, unb64(box['salt']), box['iterations'])
    return json.loads(AESGCM(key).decrypt(unb64(box['iv']), unb64(box['data']), None))


def encrypt_bytes(key, data):
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, data, None)


def decrypt_bytes(key, data):
    return AESGCM(key).decrypt(data[:12], data[12:], None)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    passphrase = os.environ.get('TRIP_PASSPHRASE')
    if not passphrase or cmd not in ('encrypt', 'decrypt'):
        sys.exit("usage: TRIP_PASSPHRASE='...' python3 tools/vault.py encrypt|decrypt")

    if cmd == 'encrypt':
        trip = json.loads(PLAIN.read_text())
        if not trip.get('contentKey'):
            trip['contentKey'] = b64(os.urandom(32))
            PLAIN.write_text(json.dumps(trip, indent=2, ensure_ascii=False) + '\n')
        key = unb64(trip['contentKey'])
        BOX_IMG.mkdir(parents=True, exist_ok=True)
        images = {}
        files = sorted(p for p in PLAIN_IMG.glob('*') if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')) if PLAIN_IMG.exists() else []
        for f in files:
            data = f.read_bytes()
            ident = hashlib.sha256(trip['contentKey'].encode() + data).hexdigest()[:20]
            out = BOX_IMG / f'{ident}.bin'
            if not out.exists():
                out.write_bytes(encrypt_bytes(key, data))
            images[f.stem] = {'id': ident, 'type': 'image/png' if f.suffix.lower() == '.png' else 'image/jpeg'}
        keep = {f"{i['id']}.bin" for i in images.values()}
        for f in BOX_IMG.glob('*.bin'):
            if f.name not in keep:
                f.unlink()
        box = encrypt_json({**trip, 'images': images}, passphrase)
        decrypt_json(box, passphrase)  # round-trip check before overwriting
        BOX.write_text(json.dumps(box) + '\n')
        print(f'encrypted trip data and {len(images)} images')
    else:
        trip = decrypt_json(json.loads(BOX.read_text()), passphrase)
        images = trip.pop('images', {})
        PLAIN_IMG.mkdir(parents=True, exist_ok=True)
        key = unb64(trip['contentKey']) if trip.get('contentKey') else None
        for name, meta in images.items():
            data = decrypt_bytes(key, (BOX_IMG / f"{meta['id']}.bin").read_bytes())
            (PLAIN_IMG / f"{name}{'.png' if meta['type'] == 'image/png' else '.jpg'}").write_bytes(data)
        PLAIN.write_text(json.dumps(trip, indent=2, ensure_ascii=False) + '\n')
        print(f'decrypted trip data and {len(images)} images into private/')


if __name__ == '__main__':
    main()
