// The collector map page (Leaflet + street tiles), shown full screen in a WebView. Same data as the
// website's map: only Barangay Poblacion is in focus (outside it is faded), zone areas are dashed
// (provisional), truck stops are numbered and coloured by today's state, and the truck is a top-view
// truck turned to its direction of travel.
// The app talks to it with injectJavaScript (setMe, fitAll, focusStop) and receives { open: url },
// { ready: true } and { picked: stopId } messages.
import boundary from './poblacionBoundary.json';
import { TRUCK_TOP_SVG } from './truckSvg';

const esc = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

/** insets: pixels covered by the app's own panels at the top and bottom, so the barangay fits between them. */
export function mapHtml({ zones, stops, emergencies = [] }, insets = { top: 90, bottom: 200 }) {
  const pob = boundary.features.find((f) => f.properties.kind === 'barangay_boundary');
  const ext = boundary.features.find((f) => f.properties.kind === 'display_extent') || pob;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; background: #eef1ed; font-family: -apple-system, Roboto, "Segoe UI", sans-serif; }
  .zone-label { background: rgba(255,255,255,.75); border: 0; border-radius: 6px; box-shadow: none; padding: 1px 5px; font-weight: 800; font-size: 11px; color: #14231d; }
  .zone-label:before { display: none; }
  .stop { width: 30px; height: 30px; border-radius: 50%; border: 3px solid #fff; display: grid; place-items: center;
          box-shadow: 0 2px 6px rgba(0,0,0,.35); color: #fff; font-size: 14px; font-weight: 800; }
  .stop.next { width: 36px; height: 36px; font-size: 16px; box-shadow: 0 0 0 5px rgba(31,107,74,.25), 0 2px 6px rgba(0,0,0,.35); }
  .em { width: 30px; height: 30px; border-radius: 50%; background: #c2412d; color: #fff; border: 3px solid #fff; display: grid; place-items: center;
        font-size: 16px; font-weight: 900; box-shadow: 0 0 0 4px rgba(194,65,45,.25), 0 2px 6px rgba(0,0,0,.35); }
  .em.later { background: #fff; color: #c2412d; border-color: #c2412d; }
  .me { position: relative; width: 48px; height: 48px; display: grid; place-items: center; }
  .me:before { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: rgba(31,107,74,.22); animation: pulse 2s ease-out infinite; }
  .me .body { position: relative; width: 26px; height: 38px; color: #1f6b4a; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); transition: transform .6s ease; }
  .me .body svg { display: block; width: 100%; height: 100%; }
  @keyframes pulse { 0% { transform: scale(.7); opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }
  .leaflet-popup-content-wrapper { border-radius: 14px; }
  .leaflet-popup-content { font-size: 14px; line-height: 1.45; margin: 12px 14px; color: #14231d; }
  .leaflet-popup-content b { font-size: 15px; }
  .muted { color: #4b5a53; }
  .go { display: inline-block; margin-top: 8px; color: #1f6b4a; font-weight: 800; text-decoration: none; }
  .leaflet-control-attribution { font-size: 9px; }
  #msg { position: absolute; z-index: 999; left: 12px; right: 70px; top: ${Math.round(insets.top + 8)}px; background: #fff; border-radius: 10px; padding: 8px 10px;
         font-size: 13px; color: #4b5a53; box-shadow: 0 2px 8px rgba(0,0,0,.2); display: none; }
</style></head><body><div id="map"></div><div id="msg"></div>
<script>
  var ZONES = ${esc(zones)}, STOPS = ${esc(stops)}, EMERG = ${esc(emergencies)}, POB = ${esc(pob)}, EXT = ${esc(ext)};
  var INSETS = ${esc(insets)};
  var COLORS = { done: '#1f8a5b', now: '#2563a8', upcoming: '#a8670e', late: '#c2412d', missed: '#c2412d', off: '#75837c' };
  var TRUCK = ${esc(TRUCK_TOP_SVG)};
  function post(o) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function msg(t) { var m = document.getElementById('msg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; }
  function esc2(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
  if (!window.L) { msg('The map needs an internet connection.'); }
  else {
    var map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25 });
    var tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
    var tileErrors = 0; tiles.on('tileerror', function () { if (++tileErrors === 3) msg('Street map could not load. Zones and stops are still shown.'); });
    // Outside Poblacion is faded (still visible for context), so the barangay stands out.
    map.createPane('outside'); map.getPane('outside').style.zIndex = 350; map.getPane('outside').style.pointerEvents = 'none';
    var ring = EXT.geometry.coordinates[0].map(function (c) { return [c[1], c[0]]; });
    L.polygon([[[-90, -360], [-90, 360], [90, 360], [90, -360]], ring], { pane: 'outside', stroke: false, fillColor: '#eef1ed', fillOpacity: 0.72, interactive: false }).addTo(map);
    L.geoJSON(POB, { style: { color: '#14231d', weight: 3, fill: false, interactive: false } }).addTo(map);
    var bounds = L.latLngBounds(ring);
    var fitOpts = { paddingTopLeft: [14, INSETS.top + 8], paddingBottomRight: [14, INSETS.bottom + 8], animate: false };
    map.fitBounds(bounds, fitOpts);
    map.setMaxBounds(bounds.pad(1.2)); map.setMinZoom(map.getZoom() - 1);
    ZONES.forEach(function (z) {
      if (z.area && z.area.length > 2) L.polygon(z.area, { color: '#4b5a53', weight: 1.5, fillColor: '#1f6b4a', fillOpacity: 0.05, dashArray: '5 4', interactive: false })
        .bindTooltip(z.name.replace('Zone ', 'Z'), { permanent: true, direction: 'center', className: 'zone-label' }).addTo(map);
      if (z.path && z.path.length > 1) L.polyline(z.path, { color: '#1f6b4a', weight: 4, opacity: 0.8, interactive: false }).addTo(map);
    });
    var markers = {};
    STOPS.forEach(function (s) {
      var c = COLORS[s.state] || COLORS.off;
      var label = s.state === 'done' ? '&#10003;' : s.state === 'missed' ? '&#10005;' : (s.order ? s.order : '&#9873;');
      var size = s.next ? 36 : 30;
      var m = L.marker([s.lat, s.lng], { zIndexOffset: s.next ? 800 : 0, icon: L.divIcon({ className: '', html: '<div class="stop' + (s.next ? ' next' : '') + '" style="background:' + c + '">' + label + '</div>', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) }).addTo(map);
      m.bindPopup('<b>' + esc2(s.name) + '</b><br>' + esc2(s.when) + '<br><span class="muted">Serves ' + esc2(s.zones.join(', ')) + '</span>' +
        (s.landmark ? '<br><span class="muted">' + esc2(s.landmark) + '</span>' : '') +
        '<br><a class="go" href="#" data-url="' + esc2(s.url) + '">Directions in Google Maps &rsaquo;</a>', { maxWidth: 260, autoPanPaddingTopLeft: [12, INSETS.top + 10], autoPanPaddingBottomRight: [12, INSETS.bottom + 10] });
      m.on('click', function () { post({ picked: s.id }); });
      markers[s.id] = m;
    });
    var emMarkers = {};
    EMERG.forEach(function (e) {
      var m = L.marker([e.lat, e.lng], { zIndexOffset: 900, icon: L.divIcon({ className: '', html: '<div class="em' + (e.later ? ' later' : '') + '">!</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map);
      m.bindPopup('<b>Emergency pickup</b><br>' + esc2(e.location) + '<br>' + esc2(e.when) + '<br><span class="muted">' + esc2(e.reason) + '</span>' +
        '<br><a class="go" href="#" data-url="' + esc2(e.url) + '">Directions in Google Maps &rsaquo;</a>', { maxWidth: 260, autoPanPaddingTopLeft: [12, INSETS.top + 10], autoPanPaddingBottomRight: [12, INSETS.bottom + 10] });
      emMarkers[e.id] = m;
    });
    window.focusEmergency = function (id) { var m = emMarkers[id]; if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 17)); m.openPopup(); } };
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-url]');
      if (a) { e.preventDefault(); post({ open: a.getAttribute('data-url') }); }
    }, true);
    window.fitAll = function () { map.fitBounds(bounds, Object.assign({}, fitOpts, { animate: true })); };
    window.focusStop = function (id) { var m = markers[id]; if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 17)); m.openPopup(); } };
    var me = null;
    // heading: degrees from north (direction of travel), or null when not moving / unknown.
    window.setMe = function (lat, lng, follow, heading) {
      if (lat == null) return;
      if (!me) me = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="me"><div class="body">' + TRUCK + '</div></div>', iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -16] }), zIndexOffset: 1000 }).addTo(map).bindPopup('You (the truck)');
      else me.setLatLng([lat, lng]);
      if (heading != null && isFinite(heading) && heading >= 0) {
        var b = me.getElement() && me.getElement().querySelector('.body');
        if (b) b.style.transform = 'rotate(' + Math.round(heading) + 'deg)';
      }
      if (follow) map.setView([lat, lng], Math.max(map.getZoom(), 17));
    };
    post({ ready: true });
  }
</script></body></html>`;
}
