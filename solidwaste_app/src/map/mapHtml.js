// The fallback map page (Leaflet + street tiles), shown in a WebView when the app has no Google Maps key
// (see app.config.js). Same picture as the Google map: only Barangay Poblacion is in focus (outside it is
// faded), zone areas are dashed (provisional), truck stops are numbered and coloured by today's state,
// emergency pickups are red "!" pins, and trucks are top-view trucks turned to their direction of travel.
// The app drives it with injectJavaScript (setTrucks, setSatellite, fitAll, focusStop, focusEmergency,
// focusPoint) and receives { ready }, { picked: stopId } and { open: url } messages.
import { EXTENT, POB } from './geo';
import { TRUCK_TOP_SVG } from './truckSvg';

const esc = (v) => JSON.stringify(v ?? null).replace(/</g, '\\u003c');

/** insets: pixels covered by the app's own panels at the top and bottom, so the barangay fits between them. */
export function mapHtml({ zones = [], stops = [], emergencies = [] }, { insets = { top: 90, bottom: 200 }, myZone = null, satellite = false } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; background: #eef1ed; font-family: -apple-system, Roboto, "Segoe UI", sans-serif; }
  .zone-label { background: rgba(255,255,255,.8); border: 0; border-radius: 6px; box-shadow: none; padding: 1px 5px; font-weight: 800; font-size: 11px; color: #14231d; }
  .zone-label.mine { background: #1f6b4a; color: #fff; }
  .zone-label:before { display: none; }
  .stop { width: 30px; height: 30px; border-radius: 50%; border: 3px solid #fff; display: grid; place-items: center;
          box-shadow: 0 2px 6px rgba(0,0,0,.35); color: #fff; font-size: 14px; font-weight: 800; }
  .stop.next { width: 36px; height: 36px; font-size: 16px; box-shadow: 0 0 0 5px rgba(31,107,74,.25), 0 2px 6px rgba(0,0,0,.35); }
  .em { width: 30px; height: 30px; border-radius: 50%; background: #c2412d; color: #fff; border: 3px solid #fff; display: grid; place-items: center;
        font-size: 16px; font-weight: 900; box-shadow: 0 0 0 4px rgba(194,65,45,.25), 0 2px 6px rgba(0,0,0,.35); }
  .em.later { background: #fff; color: #c2412d; border-color: #c2412d; }
  .truck { position: relative; width: 48px; height: 48px; display: grid; place-items: center; }
  .truck.live:before { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: rgba(31,107,74,.22); animation: pulse 2s ease-out infinite; }
  .truck .body { position: relative; width: 26px; height: 38px; color: #1f6b4a; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); transition: transform .6s ease; }
  .truck.old .body { color: #75837c; }
  .truck .body svg { display: block; width: 100%; height: 100%; }
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
  var ZONES = ${esc(zones)}, STOPS = ${esc(stops)}, EMERG = ${esc(emergencies)}, POB = ${esc(POB)}, EXT = ${esc(EXTENT)};
  var INSETS = ${esc(insets)}, MY_ZONE = ${esc(myZone)};
  var COLORS = { done: '#1f8a5b', now: '#2563a8', upcoming: '#a8670e', late: '#c2412d', missed: '#c2412d', off: '#75837c' };
  var TRUCK = ${esc(TRUCK_TOP_SVG)};
  function post(o) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function msg(t) { var m = document.getElementById('msg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; }
  function esc2(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }
  if (!window.L) { msg('The map needs an internet connection.'); }
  else {
    var map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25 });
    var street = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO' });
    var photo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery &copy; Esri' });
    var tileErrors = 0;
    [street, photo].forEach(function (t) { t.on('tileerror', function () { if (++tileErrors === 3) msg('Map pictures could not load. Zones and stops are still shown.'); }); });
    // Outside Poblacion is faded (still visible for context), so the barangay stands out.
    map.createPane('outside'); map.getPane('outside').style.zIndex = 350; map.getPane('outside').style.pointerEvents = 'none';
    var ring = EXT.geometry.coordinates[0].map(function (c) { return [c[1], c[0]]; });
    var mask = L.polygon([[[-90, -360], [-90, 360], [90, 360], [90, -360]], ring], { pane: 'outside', stroke: false, fillColor: '#eef1ed', fillOpacity: 0.72, interactive: false }).addTo(map);
    var border = L.geoJSON(POB, { style: { color: '#14231d', weight: 3, fill: false, interactive: false } }).addTo(map);
    window.setSatellite = function (on) {
      if (on) { map.removeLayer(street); photo.addTo(map); } else { map.removeLayer(photo); street.addTo(map); }
      mask.setStyle({ fillColor: on ? '#000' : '#eef1ed', fillOpacity: on ? 0.5 : 0.72 });
      border.setStyle({ color: on ? '#fff' : '#14231d' });
    };
    window.setSatellite(${satellite ? 'true' : 'false'});
    var bounds = L.latLngBounds(ring);
    var fitOpts = { paddingTopLeft: [14, INSETS.top + 8], paddingBottomRight: [14, INSETS.bottom + 8], animate: false };
    map.fitBounds(bounds, fitOpts);
    map.setMaxBounds(bounds.pad(0.6)); map.setMinZoom(map.getZoom() - 1);
    ZONES.forEach(function (z) {
      var mine = MY_ZONE && z.name === MY_ZONE;
      if (z.area && z.area.length > 2) L.polygon(z.area, { color: mine ? '#1f6b4a' : '#4b5a53', weight: mine ? 2.5 : 1.5, fillColor: '#1f6b4a', fillOpacity: mine ? 0.14 : 0.05, dashArray: '5 4', interactive: false })
        .bindTooltip(z.name.replace('Zone ', 'Z'), { permanent: true, direction: 'center', className: 'zone-label' + (mine ? ' mine' : '') }).addTo(map);
      if (z.path && z.path.length > 1) L.polyline(z.path, { color: '#1f6b4a', weight: 4, opacity: 0.8, interactive: false }).addTo(map);
    });
    var popOpts = { maxWidth: 260, autoPanPaddingTopLeft: [12, INSETS.top + 10], autoPanPaddingBottomRight: [12, INSETS.bottom + 10] };
    var markers = {};
    STOPS.forEach(function (s) {
      var c = COLORS[s.state] || COLORS.off;
      var label = s.state === 'done' ? '&#10003;' : s.state === 'missed' ? '&#10005;' : (s.order ? s.order : '&#9873;');
      var size = s.next ? 36 : 30;
      var m = L.marker([s.lat, s.lng], { zIndexOffset: s.next ? 800 : 0, icon: L.divIcon({ className: '', html: '<div class="stop' + (s.next ? ' next' : '') + '" style="background:' + c + '">' + label + '</div>', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }) }).addTo(map);
      m.bindPopup('<b>' + esc2(s.name) + '</b><br>' + esc2(s.when) + (s.zones && s.zones.length ? '<br><span class="muted">Serves ' + esc2(s.zones.join(', ')) + '</span>' : '') +
        (s.landmark ? '<br><span class="muted">' + esc2(s.landmark) + '</span>' : '') +
        '<br><a class="go" href="#" data-url="' + esc2(s.url) + '">Directions in Google Maps &rsaquo;</a>', popOpts);
      m.on('click', function () { post({ picked: s.id }); });
      markers[s.id] = m;
    });
    var emMarkers = {};
    EMERG.forEach(function (e) {
      var m = L.marker([e.lat, e.lng], { zIndexOffset: 900, icon: L.divIcon({ className: '', html: '<div class="em' + (e.later ? ' later' : '') + '">!</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map);
      m.bindPopup('<b>Emergency pickup</b><br>' + esc2(e.location) + '<br>' + esc2(e.when) + (e.reason ? '<br><span class="muted">' + esc2(e.reason) + '</span>' : '') +
        (e.url ? '<br><a class="go" href="#" data-url="' + esc2(e.url) + '">Directions in Google Maps &rsaquo;</a>' : ''), popOpts);
      emMarkers[e.id] = m;
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-url]');
      if (a) { e.preventDefault(); post({ open: a.getAttribute('data-url') }); }
    }, true);
    window.fitAll = function () { map.fitBounds(bounds, Object.assign({}, fitOpts, { animate: true })); };
    function focus(m) { if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 17)); m.openPopup(); } }
    window.focusStop = function (id) { focus(markers[id]); };
    window.focusEmergency = function (id) { focus(emMarkers[id]); };
    window.focusPoint = function (lat, lng) { map.setView([lat, lng], Math.max(map.getZoom(), 17)); };
    // Trucks: [{ id, lat, lng, heading, title, sub, live }]. heading = degrees from north, or null.
    var trucks = {};
    window.setTrucks = function (list) {
      var seen = {};
      (list || []).forEach(function (t) {
        seen[t.id] = true;
        var cls = 'truck' + (t.live ? ' live' : ' old');
        var m = trucks[t.id];
        if (!m) {
          m = L.marker([t.lat, t.lng], { zIndexOffset: 1000, icon: L.divIcon({ className: '', html: '<div class="' + cls + '"><div class="body">' + TRUCK + '</div></div>', iconSize: [48, 48], iconAnchor: [24, 24], popupAnchor: [0, -16] }) }).addTo(map);
          trucks[t.id] = m;
        } else m.setLatLng([t.lat, t.lng]);
        m.bindPopup('<b>' + esc2(t.title) + '</b>' + (t.sub ? '<br><span class="muted">' + esc2(t.sub) + '</span>' : ''));
        var el = m.getElement();
        var box = el && el.querySelector('.truck'); if (box) box.className = cls;
        var b = el && el.querySelector('.body');
        if (b && t.heading != null && isFinite(t.heading) && t.heading >= 0) b.style.transform = 'rotate(' + Math.round(t.heading) + 'deg)';
      });
      Object.keys(trucks).forEach(function (id) { if (!seen[id]) { map.removeLayer(trucks[id]); delete trucks[id]; } });
    };
    window.focusTruck = function (id) { var m = trucks[id]; if (m) map.setView(m.getLatLng(), Math.max(map.getZoom(), 17)); };
    post({ ready: true });
  }
</script></body></html>`;
}
