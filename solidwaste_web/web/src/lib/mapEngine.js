/*
 * One small drawing API for every map on the website, with two engines behind it:
 *   - Google Maps (Maps JavaScript API) when VITE_GOOGLE_MAPS_API_KEY is set in web/.env
 *   - Leaflet + street tiles otherwise, or when Google Maps cannot load (no internet, key refused)
 *
 * Both engines keep the map on Barangay Poblacion only: the view is fitted to the barangay, panning is held
 * to a small margin around it, zooming out stops at the barangay, everything outside is faded, shop/place
 * pins are hidden (Google), and there is a Street / Satellite switch.
 *
 *   const eng = await createMap(canvas, { scrollZoom, satelliteButton: true });
 *   const g = eng.group();  eng.polygon(g, ring, style); eng.marker(g, [lat, lng], { html, size, anchor, popup });
 *   eng.focusPoblacion(extentRing, pobRing); eng.fit(points); eng.onClick((lat, lng) => …); eng.destroy();
 */
import L from 'leaflet';
import { MAP_FALLBACK_ATTRIBUTION, MAP_FALLBACK_URL, MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from '../config';
import { color } from './ui';

export const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();

/**
 * How the maps look on the admin website (Barangay Admin and LGU Admin): satellite only (no Satellite/Street switch), no +/- buttons
 * (scroll, pinch or double-click to zoom), the map credits folded into a small "i", the boundary the barangay
 * traced, and no on/off switch for that boundary. Anything else keeps the default look.
 */
const ADMIN_LOOK = {
  satelliteOnly: true, zoomButtons: false, compactCredit: true, boundaryToggle: false,
  boundaryUrl: '/data/poblacion_boundary_traced.geojson', credit: 'Boundary: Barangay Poblacion (traced 2026)',
};
const DEFAULT_LOOK = Object.freeze({});
export const mapLook = (role) => (role === 'barangay' || role === 'lgu' ? ADMIN_LOOK : DEFAULT_LOOK);

// ---------- Google Maps loader ----------
let googlePromise = null;
// If Google refused the key in the last 10 minutes, go straight to the street map (then try Google again).
const REFUSED_KEY = 'ecollect-gmaps-refused';
const RETRY_MS = 10 * 60 * 1000;
const refusedRecently = () => {
  try {
    const v = JSON.parse(sessionStorage.getItem(REFUSED_KEY) || 'null');
    return !!v && v.key === GOOGLE_KEY && Date.now() - v.at < RETRY_MS;
  } catch { return false; }
};
let googleFailed = refusedRecently();
let googleShown = false; // a Google map is already on screen
const failListeners = new Set();

/** Loads the Maps JavaScript API once. Resolves to google.maps, or rejects (no key, offline, refused). */
export function loadGoogleMaps() {
  if (!GOOGLE_KEY) return Promise.reject(new Error('No Google Maps key'));
  if (googleFailed) return Promise.reject(new Error('Google Maps was refused'));
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  googlePromise ??= new Promise((resolve, reject) => {
    const done = (fn, v) => { clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => { googleFailed = true; done(reject, new Error('Google Maps took too long to load')); }, 12000);
    // Google calls this when the key is wrong or not allowed for this website.
    window.gm_authFailure = () => {
      googleFailed = true;
      console.warn('Google Maps refused the API key (see the Google error above for the reason); using the street map instead.');
      try { sessionStorage.setItem(REFUSED_KEY, JSON.stringify({ key: GOOGLE_KEY, at: Date.now() })); } catch { /* ignore */ }
      failListeners.forEach((f) => f());
      // Google checks the key after the map is drawn and then covers it with "Oops! Something went wrong".
      // Reload once so every map on the page is rebuilt on the street map (the flag above stops a loop).
      if (googleShown && !failListeners.size) { window.location.reload(); return; }
      done(reject, new Error('Google Maps refused the key'));
    };
    window.__ecollectMapsReady = () => done(resolve, window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&v=weekly&loading=async&callback=__ecollectMapsReady`;
    s.async = true;
    s.onerror = () => { googleFailed = true; done(reject, new Error('Google Maps could not load')); };
    document.head.appendChild(s);
  });
  return googlePromise;
}

/** Called if Google refuses the key after a map was already shown (the page then reloads its maps on Leaflet). */
export function onGoogleRefused(fn) { failListeners.add(fn); return () => failListeners.delete(fn); }

const ringBounds = (ring) => {
  let s = 90, n = -90, w = 180, e = -180;
  for (const [la, ln] of ring) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, ln); e = Math.max(e, ln); }
  return { s, n, w, e };
};
const padBounds = (b, f) => { const dl = (b.n - b.s) * f, dn = (b.e - b.w) * f; return { s: b.s - dl, n: b.n + dl, w: b.w - dn, e: b.e + dn }; };
const signedArea = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][1] - ring[i][1]) * (ring[j][0] + ring[i][0]); return a; };

/** Map credits folded into a small "i" (the imagery and map-data credits must stay available). */
function creditButton(canvas) {
  canvas.classList.add('credit-compact');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'map-credit-btn';
  b.setAttribute('aria-label', 'Map credits');
  b.setAttribute('aria-expanded', 'false');
  b.textContent = 'i';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = canvas.classList.toggle('show-credit');
    b.setAttribute('aria-expanded', on ? 'true' : 'false');
  });
  canvas.appendChild(b);
}

/** Satellite button drawn over the map (both engines). */
function satelliteButton(canvas, onToggle) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'map-sat-btn';
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = '<span aria-hidden="true">🛰</span> Satellite';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = on ? '<span aria-hidden="true">🗺</span> Street' : '<span aria-hidden="true">🛰</span> Satellite';
    onToggle(on);
  });
  canvas.appendChild(b);
  return b;
}

/**
 * Creates the map in `canvas`. opts.alive(): return false when the page was closed meanwhile; then no map is
 * made and this resolves to null (React may mount and unmount a component quickly).
 */
export async function createMap(canvas, opts = {}) {
  const alive = () => (opts.alive ? opts.alive() : true);
  if (GOOGLE_KEY && !opts.forceLeaflet) {
    try {
      const g = await loadGoogleMaps();
      if (!alive()) return null;
      googleShown = true;
      return googleEngine(g, canvas, opts);
    } catch (err) {
      console.warn(`${err.message}; using the street map instead.`);
    }
  }
  await Promise.resolve();
  return alive() ? leafletEngine(canvas, opts) : null;
}

// ================= Google Maps =================
const NO_PLACES = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

function googleEngine(g, canvas, opts) {
  // The map fills its box (the box only has a min-height, so the map sits in an absolutely placed layer).
  const host = document.createElement('div');
  host.className = 'gmap-host';
  canvas.appendChild(host);
  const map = new g.Map(host, {
    center: { lat: 8.229, lng: 124.2365 }, zoom: 16, mapTypeId: 'roadmap', styles: NO_PLACES, clickableIcons: false,
    disableDefaultUI: true, zoomControl: opts.zoomButtons !== false, fullscreenControl: false, streetViewControl: false, mapTypeControl: false,
    rotateControl: false, tilt: 0, isFractionalZoomEnabled: true,
    gestureHandling: opts.scrollZoom ? 'greedy' : 'cooperative', keyboardShortcuts: true,
  });
  const info = new g.InfoWindow({ maxWidth: 300 });
  const clicks = [];
  const listeners = [];
  let satellite = false;
  let maskPoly = null, borderLine = null, extent = null;

  // HTML marker without a Map ID (so the "hide places" style keeps working).
  class HtmlMarker extends g.OverlayView {
    constructor(pos, o) {
      super();
      this.pos = new g.LatLng(pos[0], pos[1]); this.o = o;
      this.div = document.createElement('div');
      this.div.style.position = 'absolute';
      this.div.style.zIndex = String(o.zIndex ?? 1);
      this.div.style.cursor = o.popup || o.onClick ? 'pointer' : '';
      if (o.title) this.div.title = o.title;
      this.div.innerHTML = o.html;
      if (o.popup || o.onClick) {
        this.div.addEventListener('click', (e) => { e.stopPropagation(); if (o.onClick) o.onClick(); if (o.popup) this.openPopup(); });
      } else this.div.style.pointerEvents = 'none';
    }
    onAdd() { (this.o.label ? this.getPanes().overlayLayer : this.getPanes().overlayMouseTarget).appendChild(this.div); }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(this.pos);
      if (!p) return;
      const [ax, ay] = this.o.anchor ?? [0, 0];
      this.div.style.left = `${p.x - ax}px`; this.div.style.top = `${p.y - ay}px`;
    }
    onRemove() { this.div.remove(); }
    setPosition(lat, lng) { this.pos = new g.LatLng(lat, lng); this.draw(); }
    getPosition() { return [this.pos.lat(), this.pos.lng()]; }
    getElement() { return this.div; }
    openPopup() { info.setContent(this.o.popup); info.setPosition(this.pos); info.setOptions({ pixelOffset: new g.Size(0, -((this.o.anchor ?? [0, 0])[1])) }); info.open({ map }); }
  }

  const groups = [];
  const group = (visible = true) => {
    const items = [];
    const gr = {
      visible, items,
      add(it) { items.push(it); it.setMap(gr.visible ? map : null); return it; },
      clear() { items.forEach((it) => it.setMap(null)); items.length = 0; },
      setVisible(v) { gr.visible = v; items.forEach((it) => it.setMap(v ? map : null)); },
    };
    groups.push(gr);
    return gr;
  };
  const ll = (p) => ({ lat: p[0], lng: p[1] });
  const dashIcons = (weight, colorV) => [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: colorV, scale: Math.max(1.5, weight) }, offset: '0', repeat: `${Math.round(weight * 5 + 6)}px` }];

  const eng = {
    kind: 'google', map,
    group,
    polygon(gr, ring, st = {}) {
      const poly = new g.Polygon({ paths: ring.map(ll), strokeColor: st.color, strokeWeight: st.dashed ? 0 : st.weight ?? 2, strokeOpacity: st.dashed ? 0 : 1,
        fillColor: st.fillColor ?? st.color, fillOpacity: st.fillOpacity ?? 0.15, clickable: !!st.onClick, zIndex: st.zIndex ?? 1 });
      if (st.onClick) poly.addListener('click', st.onClick);
      gr.add(poly);
      if (st.dashed) {
        const edge = new g.Polyline({ path: [...ring, ring[0]].map(ll), strokeOpacity: 0, icons: dashIcons(st.weight ?? 2, st.color), clickable: false, zIndex: (st.zIndex ?? 1) + 1 });
        gr.add(edge);
      }
      if (st.label) {
        const b = ringBounds(ring);
        gr.add(new HtmlMarker([(b.s + b.n) / 2, (b.w + b.e) / 2], { html: `<div class="zone-label gm">${st.label}</div>`, anchor: [0, 0], label: true, zIndex: 2 }));
      }
      return poly;
    },
    polyline(gr, pts, st = {}) {
      const line = new g.Polyline({ path: pts.map(ll), strokeColor: st.color, strokeWeight: st.weight ?? 3, strokeOpacity: st.dashed ? 0 : st.opacity ?? 1,
        icons: st.dashed ? dashIcons(st.weight ?? 3, st.color) : undefined, clickable: !!(st.onClick || st.tooltip), zIndex: st.zIndex ?? 3 });
      if (st.onClick) line.addListener('click', st.onClick);
      if (st.tooltip) line.addListener('mouseover', (e) => { info.setContent(`<div>${st.tooltip}</div>`); info.setPosition(e.latLng); info.setOptions({ pixelOffset: new g.Size(0, 0) }); info.open({ map }); });
      return gr.add(line);
    },
    marker(gr, pos, o) { return gr.add(new HtmlMarker(pos, o)); },
    /** Poblacion only: faded outside, bold boundary, camera held around the barangay. */
    focusPoblacion(extentRing, pobRing, { fit = true } = {}) {
      extent = extentRing;
      const b = ringBounds(extentRing), lim = padBounds(b, 0.2);
      const box = [[b.s - 1, b.w - 1], [b.n + 1, b.w - 1], [b.n + 1, b.e + 1], [b.s - 1, b.e + 1]];
      const hole = signedArea(extentRing) * signedArea(box) > 0 ? [...extentRing].reverse() : extentRing;
      maskPoly?.setMap(null); borderLine?.setMap(null);
      maskPoly = new g.Polygon({ paths: [box.map(ll), hole.map(ll)], strokeWeight: 0, fillColor: satellite ? '#000000' : (color('bg') || '#f3f5f2'), fillOpacity: satellite ? 0.55 : 0.85, clickable: false, zIndex: 0, map });
      if (pobRing) borderLine = new g.Polyline({ path: [...pobRing, pobRing[0]].map(ll), strokeColor: satellite ? '#ffffff' : '#14231d', strokeWeight: 3, clickable: false, zIndex: 1, map });
      map.setOptions({ restriction: { latLngBounds: { north: lim.n, south: lim.s, east: lim.e, west: lim.w }, strictBounds: false } });
      if (fit) eng.fit(extentRing, 12);
      g.event.addListenerOnce(map, 'idle', () => { const z = map.getZoom(); if (Number.isFinite(z)) map.setOptions({ minZoom: Math.max(14, z - 0.5), maxZoom: 20 }); });
    },
    refreshMask() { if (extent) eng.focusPoblacion(extent, borderLine ? borderLine.getPath().getArray().map((p) => [p.lat(), p.lng()]).slice(0, -1) : null, { fit: false }); },
    fit(points, padding = 30, { maxZoom } = {}) {
      if (!points.length) return;
      const bd = new g.LatLngBounds();
      points.forEach((p) => bd.extend(ll(p)));
      map.fitBounds(bd, padding);
      if (maxZoom) g.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > maxZoom) map.setZoom(maxZoom); });
    },
    setView(lat, lng, zoom) { map.panTo({ lat, lng }); if (zoom) map.setZoom(Math.max(map.getZoom(), zoom)); },
    onClick(fn) { clicks.push(fn); },
    setSatellite(on) { satellite = on; map.setMapTypeId(on ? 'hybrid' : 'roadmap'); eng.refreshMask(); },
    resize() { g.event.trigger(map, 'resize'); },
    closePopup() { info.close(); },
    destroy() { listeners.forEach((l) => l.remove()); groups.forEach((gr) => gr.clear()); maskPoly?.setMap(null); borderLine?.setMap(null); info.close(); host.remove(); canvas.querySelectorAll('.map-sat-btn').forEach((b) => b.remove()); },
  };
  listeners.push(map.addListener('click', (e) => { info.close(); clicks.forEach((f) => f(e.latLng.lat(), e.latLng.lng())); }));
  if (opts.satelliteOnly) eng.setSatellite(true);
  else if (opts.satelliteButton !== false) satelliteButton(canvas, (on) => eng.setSatellite(on));
  return eng;
}

// ================= Leaflet (fallback) =================
function leafletEngine(canvas, opts) {
  const map = L.map(canvas, { zoomControl: opts.zoomButtons !== false, zoomSnap: 0.25, scrollWheelZoom: !!opts.scrollZoom, attributionControl: true }).setView([8.229, 124.2365], 16);
  if (!opts.scrollZoom) {
    canvas.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); map.scrollWheelZoom.enable(); } else map.scrollWheelZoom.disable();
    }, { passive: false });
  }
  const credit = ` | ${opts.credit || 'Boundary: PSA/NAMRIA 2023'}`;
  let tiles = null, usingFallback = false, tileErrors = 0, tileLoads = 0, satellite = false;
  const msg = document.createElement('div');
  msg.className = 'map-msg'; msg.hidden = true; canvas.appendChild(msg);
  const showMsg = (t) => { msg.textContent = t; msg.hidden = !t; };
  function addTiles(url, attribution) {
    if (tiles) map.removeLayer(tiles);
    tileErrors = 0; tileLoads = 0;
    tiles = L.tileLayer(url, { maxZoom: 19, subdomains: 'abcd', referrerPolicy: 'strict-origin-when-cross-origin', attribution: attribution + credit }).addTo(map);
    tiles.bringToBack();
    tiles.on('tileload', () => { tileLoads++; });
    tiles.on('tileerror', () => {
      tileErrors++;
      if (tileErrors < 4 || tileLoads > 0) return;
      if (!satellite && !usingFallback) { usingFallback = true; addTiles(MAP_FALLBACK_URL, MAP_FALLBACK_ATTRIBUTION); }
      else showMsg('Map pictures could not load (no internet?). The boundary, zones, routes and vehicles are still shown.');
    });
  }
  addTiles(MAP_TILE_URL, MAP_TILE_ATTRIBUTION);
  map.createPane('outside');
  map.getPane('outside').style.zIndex = 350;
  map.getPane('outside').style.pointerEvents = 'none';
  let mask = null, border = null, extent = null, pob = null;

  const group = (visible = true) => {
    const lg = L.layerGroup();
    if (visible) lg.addTo(map);
    return {
      lg, visible,
      add(l) { l.addTo(lg); return l; },
      clear() { lg.clearLayers(); },
      setVisible(v) { this.visible = v; if (v) lg.addTo(map); else map.removeLayer(lg); },
    };
  };
  const wrapMarker = (m, o) => ({
    setMap(x) { if (!x) m.remove(); },
    setPosition(lat, lng) { m.setLatLng([lat, lng]); },
    getPosition() { const p = m.getLatLng(); return [p.lat, p.lng]; },
    getElement() { return m.getElement(); },
    openPopup() { if (o.popup) m.openPopup(); },
    leaflet: m,
  });
  const eng = {
    kind: 'leaflet', map,
    group,
    polygon(gr, ring, st = {}) {
      const p = L.polygon(ring, { color: st.color, weight: st.weight ?? 2, fillColor: st.fillColor ?? st.color, fillOpacity: st.fillOpacity ?? 0.15,
        dashArray: st.dashed ? '6 4' : null, interactive: !!st.onClick });
      if (st.onClick) p.on('click', st.onClick);
      if (st.label) p.bindTooltip(st.label, { permanent: true, direction: 'center', className: 'zone-label' });
      return gr.add(p);
    },
    polyline(gr, pts, st = {}) {
      const p = L.polyline(pts, { color: st.color, weight: st.weight ?? 3, opacity: st.opacity ?? 1, dashArray: st.dashed ? '6 6' : null, interactive: !!(st.onClick || st.tooltip) });
      if (st.onClick) p.on('click', st.onClick);
      if (st.tooltip) p.bindTooltip(st.tooltip, { sticky: true });
      return gr.add(p);
    },
    marker(gr, pos, o) {
      const m = L.marker(pos, { icon: L.divIcon({ className: '', html: o.html, iconSize: o.size, iconAnchor: o.anchor }), title: o.title, zIndexOffset: o.zIndex ?? 0,
        interactive: !!(o.popup || o.onClick), keyboard: !!(o.popup || o.onClick) });
      if (o.popup) m.bindPopup(o.popup, { maxWidth: 280, minWidth: 220, autoPanPaddingTopLeft: L.point(56, 16), autoPanPaddingBottomRight: L.point(16, 16) });
      if (o.onClick) m.on('click', o.onClick);
      gr.add(m);
      return wrapMarker(m, o);
    },
    focusPoblacion(extentRing, pobRing, { fit = true } = {}) {
      extent = extentRing; pob = pobRing;
      if (mask) map.removeLayer(mask);
      if (border) map.removeLayer(border);
      const world = [[-90, -360], [-90, 360], [90, 360], [90, -360]];
      mask = L.polygon([world, extentRing], { pane: 'outside', stroke: false, fillColor: satellite ? '#000' : (color('bg') || '#f3f5f2'), fillOpacity: satellite ? 0.55 : 1, interactive: false }).addTo(map);
      if (pobRing) border = L.polygon(pobRing, { color: satellite ? '#fff' : '#14231d', weight: 3, fill: false, interactive: false }).addTo(map);
      const b = L.latLngBounds(extentRing);
      map.setMaxBounds(b.pad(0.2));
      map.options.maxBoundsViscosity = 0.9;
      if (fit) map.fitBounds(b, { padding: [12, 12], animate: false });
      map.setMinZoom(Math.max(14, map.getBoundsZoom(b) - 0.5));
    },
    refreshMask() { if (extent) eng.focusPoblacion(extent, pob, { fit: false }); },
    fit(points, padding = 30, { maxZoom } = {}) { if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [padding, padding], maxZoom, animate: false }); },
    setView(lat, lng, zoom) { map.setView([lat, lng], Math.max(map.getZoom(), zoom ?? map.getZoom())); },
    onClick(fn) { map.on('click', (e) => fn(e.latlng.lat, e.latlng.lng)); },
    setSatellite(on) {
      satellite = on;
      if (on) addTiles('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Imagery &copy; Esri');
      else { usingFallback = false; addTiles(MAP_TILE_URL, MAP_TILE_ATTRIBUTION); }
      eng.refreshMask();
    },
    resize() { map.invalidateSize(); },
    closePopup() { map.closePopup(); },
    showMsg,
    destroy() { map.remove(); canvas.classList.remove('credit-compact', 'show-credit'); canvas.querySelectorAll('.map-sat-btn, .map-msg, .map-credit-btn').forEach((b) => b.remove()); },
  };
  if (opts.satelliteOnly) eng.setSatellite(true);
  else if (opts.satelliteButton !== false) satelliteButton(canvas, (on) => eng.setSatellite(on));
  if (opts.compactCredit) creditButton(canvas);
  return eng;
}

/** Reads the Poblacion boundary file: { pob: [[lat,lng]…], extent: [[lat,lng]…] }. */
export async function loadBoundary(url = '/data/poblacion_boundary.geojson') {
  const geo = await (await fetch(url, { credentials: 'same-origin' })).json();
  const pob = geo.features.find((f) => f.properties.kind === 'barangay_boundary');
  const ext = geo.features.find((f) => f.properties.kind === 'display_extent') || pob;
  const ring = (f) => f.geometry.coordinates[0].map((c) => [c[1], c[0]]);
  return { pob: pob ? ring(pob) : null, extent: ring(ext) };
}

/** Moves a marker smoothly from where it is to (lat, lng) over `ms`. */
export function glide(handle, lat, lng, ms = 1500) {
  const [a, b] = handle.getPosition();
  if (Math.abs(a - lat) < 1e-7 && Math.abs(b - lng) < 1e-7) return;
  if (handle._anim) cancelAnimationFrame(handle._anim);
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    handle.setPosition(a + (lat - a) * e, b + (lng - b) * e);
    if (k < 1) handle._anim = requestAnimationFrame(step); else handle._anim = null;
  };
  handle._anim = requestAnimationFrame(step);
}
