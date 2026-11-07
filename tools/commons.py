#!/usr/bin/env python3
"""Search Wikimedia Commons for freely licensed photos, or download one with its credit.

    python3 tools/commons.py search "Grasse old town" [n]
    python3 tools/commons.py get "File:Some photo.jpg" <name> [width]

`get` saves private/img/<name>.jpg (scaled to `width`, default 1600 px) and prints
a JSON credit line (author, licence, source page) to paste into the trip data.
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

API = 'https://commons.wikimedia.org/w/api.php'
UA = {'User-Agent': 'GrandTourTravelApp/1.0 (personal, non-commercial)'}
FREE = re.compile(r'^(CC0|CC BY(-SA)? [\d.]+|Public domain|PD.*)', re.I)


def call(**params):
    q = urllib.parse.urlencode({'format': 'json', 'formatversion': 2, **params})
    for wait in (5, 15, 45, 0):  # Commons rate-limits bursts (HTTP 429)
        try:
            with urllib.request.urlopen(urllib.request.Request(f'{API}?{q}', headers=UA)) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or not wait:
                raise
            time.sleep(wait)


def strip(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html or '')).strip()


def info(titles, width):
    d = call(action='query', titles='|'.join(titles), prop='imageinfo',
             iiprop='url|size|extmetadata', iiurlwidth=width)
    out = []
    for p in d['query']['pages']:
        ii = (p.get('imageinfo') or [{}])[0]
        m = ii.get('extmetadata', {})
        out.append({
            'title': p['title'], 'w': ii.get('width'), 'h': ii.get('height'),
            'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl'),
            'author': strip(m.get('Artist', {}).get('value'))[:80],
            'license': m.get('LicenseShortName', {}).get('value', ''),
        })
    return out


cmd = sys.argv[1]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
if cmd == 'search':
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    hits = call(action='query', list='search', srnamespace=6, srlimit=n,
                srsearch=f'{sys.argv[2]} filetype:bitmap filew:>1800')['query']['search']
    for i in info([h['title'] for h in hits], 400) if hits else []:
        ok = 'ok ' if FREE.match(i['license']) else 'NO '
        print(f"{ok}{i['w']}x{i['h']}  {i['title']}  [{i['license']}; {i['author'][:40]}]")
elif cmd == 'get':
    title, name = sys.argv[2], sys.argv[3]
    width = int(sys.argv[4]) if len(sys.argv) > 4 else 1600
    i = info([title], width)[0]
    if not FREE.match(i['license']):
        sys.exit(f"not freely licensed: {i['license']}")
    os.makedirs(os.path.join(root, 'private', 'img'), exist_ok=True)
    dest = os.path.join(root, 'private', 'img', f'{name}.jpg')
    with urllib.request.urlopen(urllib.request.Request(i['thumb'], headers=UA)) as r, open(dest, 'wb') as fh:
        fh.write(r.read())
    print(json.dumps({'img': name, 'credit': {'author': i['author'], 'license': i['license'], 'source': i['page']}}, ensure_ascii=False))
