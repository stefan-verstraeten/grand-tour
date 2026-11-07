// The illustrated route map: Natural Earth land, lakes and borders drawn as a quiet
// engraving, with the journey as one fine line through numbered stops. Pure SVG,
// so it works offline and stays crisp at any size.

import { FRAME, LAND, LAKES, BORDERS } from './map-data.js';

export const project = (lon, lat) => [
  (lon - FRAME.lon0) * FRAME.k * FRAME.scale,
  (FRAME.lat1 - lat) * FRAME.scale,
];

const LABELS = [
  { text: 'FRANCE', lon: 3.9, lat: 46.4, cls: 'country' },
  { text: 'SUISSE', lon: 7.35, lat: 46.62, cls: 'country' },
  { text: 'ITALIA', lon: 11.15, lat: 45.35, cls: 'country' },
  { text: 'DEUTSCHLAND', lon: 9.2, lat: 48.75, cls: 'country' },
  { text: 'BELGIQUE', lon: 4.6, lat: 50.25, cls: 'country' },
  { text: 'Mer Méditerranée', lon: 5.4, lat: 42.95, cls: 'sea-label' },
  { text: 'Mar Ligure', lon: 9.0, lat: 43.62, cls: 'sea-label' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Catmull-Rom through the points, as cubic Béziers: a hand-drawn, unhurried line.
function smooth(pts, tension = 0.5) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = tension / 3;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * stops: [{ id, name, lat, lon, n (chapter number), label: 'r'|'l'|'t'|'b', tentative, now }]
 * opts: { aspect (h/w), pad (px in frame units), home: {lat, lon} | null, widthPx }
 */
export function routeMap(stops, { aspect = 0.82, pad = 70, home = null, widthPx = 400, focus = null } = {}) {
  const pts = stops.map((s) => ({ ...s, xy: project(s.lon, s.lat) }));
  const all = pts.map((p) => p.xy);
  if (home) all.push(project(home.lon, home.lat));
  const focusPts = focus ? pts.filter((p) => focus.includes(p.id)).map((p) => p.xy) : all;

  let x0 = Math.min(...focusPts.map((p) => p[0])) - pad;
  let x1 = Math.max(...focusPts.map((p) => p[0])) + pad;
  let y0 = Math.min(...focusPts.map((p) => p[1])) - pad;
  let y1 = Math.max(...focusPts.map((p) => p[1])) + pad;
  // Fit the requested aspect ratio around the route.
  const w = x1 - x0;
  const h = y1 - y0;
  if (h / w > aspect) { const nw = h / aspect; x0 -= (nw - w) / 2; x1 = x0 + nw; } else { const nh = w * aspect; y0 -= (nh - h) / 2; y1 = y0 + nh; }
  const vw = x1 - x0;
  const vh = y1 - y0;
  const u = vw / widthPx; // frame units per CSS pixel
  const fs = (px) => `--fs:${(px * u).toFixed(1)}px`;

  const legs = [];
  for (let i = 0; i < pts.length - 1; i++) legs.push({ a: pts[i], b: pts[i + 1], dotted: pts[i].tentative || pts[i + 1].tentative });
  // One smooth line, split into segments so tentative legs can be dotted.
  const line = smooth(pts.map((p) => p.xy), 0.35);

  let homeLeg = '';
  if (pts.length) {
    const first = pts[0].xy;
    const last = pts[pts.length - 1].xy;
    if (home) {
      const h = project(home.lon, home.lat);
      homeLeg = `<path class="home-leg" style="stroke-width:${(1.1 * u).toFixed(2)}" d="M${h[0]},${h[1]} L${first[0]},${first[1]}"/>`
        + `<path class="home-leg" style="stroke-width:${(1.1 * u).toFixed(2)}" d="${smooth([last, [(last[0] + h[0]) / 2 - 40, (last[1] + h[1]) / 2], h], 0.4)}"/>`
        + `<circle class="stop open" cx="${h[0]}" cy="${h[1]}" r="${4 * u}"/>`
        + `<text class="label" style="${fs(15)}" x="${h[0] + 9 * u}" y="${h[1] + 5 * u}">${esc(home.name || 'Home')}</text>`;
    } else {
      // Home not set yet: a short dotted stub from the north-west.
      const s = [first[0] - 34 * u, first[1] - 44 * u];
      homeLeg = `<path class="home-leg" style="stroke-width:${(1.1 * u).toFixed(2)}" d="M${s[0]},${s[1]} L${first[0]},${first[1]}"/>`;
    }
  }

  const dash = (a, b) => `${(a * u).toFixed(1)} ${(b * u).toFixed(1)}`;
  const anyTentative = legs.some((l) => l.dotted);
  const stopsSvg = pts.map((p) => {
    const [x, y] = p.xy;
    const r = (p.now ? 6 : 4.6) * u;
    const off = 10 * u;
    const pos = {
      r: [x + off, y + 5 * u, 'start'],
      l: [x - off, y + 5 * u, 'end'],
      t: [x, y - off, 'middle'],
      b: [x, y + off + 12 * u, 'middle'],
    }[p.label || 'r'];
    return `${p.now ? `<circle class="halo" cx="${x}" cy="${y}" r="${r * 2.2}" style="stroke-width:${u}"/>` : ''}`
      + `<circle class="stop${p.tentative ? ' open' : ''}${p.now ? ' now' : ''}" cx="${x}" cy="${y}" r="${r}" style="stroke-width:${(1.3 * u).toFixed(2)}"/>`
      + (p.name ? `<text class="label${p.now ? ' strong' : ''}" style="${fs(p.now ? 17 : 15.5)};stroke-width:${(4 * u).toFixed(1)}px" x="${pos[0]}" y="${pos[1]}" text-anchor="${pos[2]}">${esc(p.name)}</text>` : '');
  }).join('');

  const labels = LABELS.map((l) => {
    const [x, y] = project(l.lon, l.lat);
    if (x < x0 || x > x1 || y < y0 || y > y1) return '';
    return `<text class="${l.cls}" style="${fs(l.cls === 'country' ? 8.5 : 13)}" x="${x}" y="${y}" text-anchor="middle">${esc(l.text)}</text>`;
  }).join('');

  return `<svg class="routemap" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" role="img" aria-label="Route map: ${esc(stops.map((s) => s.name).join(', '))}">
    <path class="land" d="${LAND}" style="stroke-width:${(0.8 * u).toFixed(2)}"/>
    <path class="lake" d="${LAKES}" style="stroke-width:${(0.6 * u).toFixed(2)}"/>
    <path class="border" d="${BORDERS}" style="stroke-width:${(0.9 * u).toFixed(2)};stroke-dasharray:${dash(1.4, 3.6)}"/>
    ${labels}
    ${homeLeg}
    <path class="route" d="${line}" style="stroke-width:${(1.4 * u).toFixed(2)}${anyTentative ? '' : ''}"/>
    ${stopsSvg}
  </svg>`;
}
