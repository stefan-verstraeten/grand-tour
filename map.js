// The zoomable map: Leaflet on OpenStreetMap, toned down to warm greys with a CSS filter
// so it sits with the paper and ink of the rest of the app.

let leafletReady = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletReady) {
    leafletReady = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet.css';
      document.head.append(css);
      const s = document.createElement('script');
      s.src = 'vendor/leaflet.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }
  return leafletReady;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function drawMap(el, data, { kindLabel, statusLabel }) {
  await loadLeaflet();
  const L = window.L;
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.25 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const stops = data.stops;
  const line = stops.map((s) => [s.lat, s.lon]);
  L.polyline(line, { color: '#292D26', weight: 1.6, opacity: 0.75, dashArray: '2 6', lineCap: 'round' }).addTo(map);

  for (const s of stops) {
    L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: '', html: '<div class="pin stop"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      zIndexOffset: 1000,
    }).addTo(map)
      .bindTooltip(esc(s.name), { permanent: true, direction: s.label === 'l' ? 'left' : 'right', className: 'stop-label', offset: [s.label === 'l' ? -8 : 8, 0] })
      .bindPopup(`<p class="eyebrow">Chapter ${s.n}</p><p class="row-title">${esc(s.name)}</p><p class="row-sub">${esc(s.tagline)}</p><a class="more" href="#/stop/${esc(s.id)}">Open chapter</a>`);
  }

  for (const e of data.experiences.filter((x) => x.lat)) {
    L.marker([e.lat, e.lon], {
      icon: L.divIcon({ className: '', html: `<div class="pin ${esc(e.kind)}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }),
    }).addTo(map)
      .bindPopup(`<p class="eyebrow">${esc(kindLabel(e.kind))} · ${esc(statusLabel(e.status))}</p><p class="row-title">${esc(e.name)}</p>${e.tagline ? `<p class="row-sub">${esc(e.tagline)}</p>` : ''}<a class="more" href="#/exp/${esc(e.id)}">Open</a>`);
  }

  // Hide the permanent stop labels when zoomed in close: the places speak for themselves.
  const labels = () => el.classList.toggle('close', map.getZoom() >= 12);
  map.on('zoomend', labels);
  map.fitBounds(L.latLngBounds(line), { paddingTopLeft: [70, 110], paddingBottomRight: [70, 40] });
  labels();
}
