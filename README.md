# Grand Tour

A private travel journal for Stefan and Marleen's winter journey through Europe
(29 November – 12 December 2026): Luxembourg, Basel, Modena, Menton, Grasse and
Avignon. The focus is on gastronomy, culture and heritage, and the occasional
landscape, more than on logistics.

It is a web app that works offline and installs like an app: on an iPhone from
Safari (Share › Add to Home Screen).

## Design

Based on the "Grand Tour" art direction: a contemporary private travel journal.

- **Paper** `#F3EFE6` and **ink** `#292D26` for most of the interface; **olive**
  `#747666` as the functional accent; **stone** `#C8BBA6` and **ochre** `#AD7954`
  sparingly, in maps, labels and small details.
- **Cormorant Garamond** for destinations, headlines and prose; **Inter** for
  times, addresses and controls. Both self-hosted in `vendor/fonts/` (SIL OFL).
- Photography over decoration, whitespace over cards, a restrained map, quiet
  interaction. No sepia, fake paper, passport stamps or dashboard widgets.

## Screens

- **Journey**: cover, dates, the illustrated route map, what's next, the great
  tables and the chapters (one per stop).
- **Chapter** (`#/stop/<id>`): a stop with its introduction, experiences by kind,
  where we stay and its days.
- **Day** (`#/day/<date>`): the day as a timeline of drives, meals, visits and the night.
- **Experience** (`#/exp/<id>`): a restaurant, sight or walk, with status
  (idea, planned, to confirm, booked, visited), practical facts and our impressions.
- **Map**: a zoomable map (OpenStreetMap, toned warm) with stops and experiences.
- **Journal**: notes and photos by day and author, shared between both phones.
- **Reading**: literary passages by place (to be gathered).
- **Practical**: hotels, reservations, emergency numbers, photo credits.

## Private data

Everything about the trip lives in `private/trip.json` and `private/img/`, which
are git-ignored. Only an encrypted copy is published:

```sh
python3 -m venv .venv && .venv/bin/pip install cryptography   # once
TRIP_PASSPHRASE="$(cat private/.passphrase)" .venv/bin/python tools/vault.py encrypt  # private/ -> data/
TRIP_PASSPHRASE='...' .venv/bin/python tools/vault.py decrypt  # data/ -> private/
```

The format (PBKDF2-SHA256 + AES-256-GCM, see `crypto.js`) is the one the app
decrypts in the browser. Photos are encrypted with a random content key stored
inside the trip data.

## Shared journal

Entries are saved on the phone first. The trip data holds a `sync` entry
(`owner`, `repo`, `branch: journal`, `token`: a fine-grained GitHub token with
Contents read/write on this repository only), so each entry is also stored
encrypted as `notes/<id>.json` on the `journal` branch, and a photo's image as
`photos/<id>.bin`. Both phones sync on opening, when back online and every minute.
The token expires: replace it in `private/trip.json` and encrypt again.

## Tools

- `tools/commons.py search "<query>"` and `tools/commons.py get "File:…" <name>`:
  find and download freely licensed Wikimedia Commons photos into `private/img/`,
  printing the credit to add under `credits` in the trip data.
- `tools/basemap.py`: rebuilds `map-data.js`, the illustrated base map, from
  Natural Earth 1:10m land, lakes and borders.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

On `localhost` the app reads the plaintext `private/trip.json` directly, so design
and content work need no passphrase.
