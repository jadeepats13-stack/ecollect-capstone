/*
 * Interactive map of Barangay Poblacion, used on both dashboards, the Live map and Zones & routes.
 * Google Maps when the website has a key (VITE_GOOGLE_MAPS_API_KEY), otherwise Leaflet street tiles
 * (see mapEngine.js). Only Barangay Poblacion is in view.
 *
 *   mountZoneMap({ canvas, side, load: (date) => Promise<mapPayload>, boundaryUrl,
 *                  pollMs, dateFilter, scrollZoom, showFeedback, onStatus, onZoneSelect })
 *
 * Nothing on this map is invented:
 *   - the barangay outline is the PSA/NAMRIA 2023 boundary (simplified)
 *   - zone areas are drawn only from saved boundary coordinates (dashed = provisional)
 *   - routes are drawn only from saved path coordinates
 *   - vehicles are the last GPS ping sent by the collector mobile app
 */
import { esc, poll } from './ui';
import { truckMarkerHtml } from './truckIcon';
import { createMap, glide, loadBoundary } from './mapEngine';


const STATUS = {
    completed: { label: 'Completed', css: 'done', color: '#1f8a5b' },
    ongoing:   { label: 'Ongoing', css: 'ongoing', color: '#2563a8' },
    pending:   { label: 'Pending', css: 'pending', color: '#a8670e' },
    delayed:   { label: 'Delayed', css: 'delayed', color: '#c2412d' },
    upcoming:  { label: 'Upcoming', css: 'pending', color: '#a8670e' },
    untracked: { label: 'Before tracking', css: '', color: '#75837c' },
    none:      { label: 'No collection', css: '', color: '#75837c' }
};
const GPS = {
    live:   { label: 'Live', note: 'Location updated in the last few minutes' },
    recent: { label: 'Recent', note: 'Last location is under an hour old' },
    stale:  { label: 'Old position', note: 'Last location is over an hour old — not live' }
};
// Truck stops: a bin (where residents bring garbage). The truck itself is the top-view truck (truckIcon.js).
const stopSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/></svg>';

export function mountZoneMap(opts) {
    const LAYERS = ['boundary', 'zones', 'routes', 'points', 'emergencies', 'feedback', 'vehicles'];
    const state = {
        data: null, selected: null, colorBy: 'status', statusFilter: 'all',
        date: null, fitted: false, layers: {},
        visible: { boundary: true, zones: true, routes: true, vehicles: true, feedback: !!opts.showFeedback,
                   points: true, emergencies: true }
    };
    let eng = null;
    let alive = true;   // background loads that finish after destroy() are ignored
    const cleanup = [];
    const trucks = new Map();   // collector id -> marker handle (kept between refreshes so trucks glide)
    let boundary = null;

    /* ---------- Side panel skeleton ---------- */
    const side = opts.side;
    side.innerHTML =
        '<div class="map-side-section">' +
            (opts.dateFilter ? '<div class="field" style="margin-bottom:10px"><label for="mapDate">Collection date</label><input class="input" type="date" id="mapDate"></div>' : '') +
            '<div class="field" style="margin-bottom:10px"><span class="label">Colour zones and routes by</span>' +
                '<div class="seg" role="group" aria-label="Colour by"><button type="button" data-colorby="status" aria-pressed="true">Status</button><button type="button" data-colorby="zone" aria-pressed="false">Zone</button></div></div>' +
            '<div class="field"><label for="mapStatus">Show zones</label><select class="select" id="mapStatus">' +
                '<option value="all">All zones</option><option value="delayed">Delayed</option><option value="ongoing">Ongoing</option>' +
                '<option value="pending">Pending / upcoming</option><option value="completed">Completed</option><option value="none">No collection that day</option></select></div>' +
        '</div>' +
        '<div class="map-side-section"><h3>Layers</h3><div class="layer-toggles">' +
            toggle('boundary', 'Barangay boundary', '<span class="layer-swatch" style="border:2px solid #14231d;background:transparent"></span>') +
            toggle('zones', 'Zone areas', '<span class="layer-swatch" style="background:#0f766e55;border:1px solid #0f766e"></span>') +
            toggle('points', 'Truck stops (fixed schedule)', '<span class="layer-swatch" style="width:12px;border-radius:3px;background:#14231d"></span>') +
            toggle('emergencies', 'Emergency collections', '<span class="layer-swatch" style="width:12px;border-radius:50%;background:#fff;border:3px solid #c2412d"></span>') +
            toggle('routes', 'Collection routes', '<span class="layer-swatch" style="height:4px;background:#2563a8"></span>') +
            toggle('vehicles', 'Garbage truck (GPS)', '<span class="layer-swatch" style="width:9px;height:13px;border-radius:2px;background:#1f6b4a"></span>') +
            toggle('feedback', 'Open resident reports', '<span class="layer-swatch" style="width:10px;height:10px;transform:rotate(45deg);background:#c2412d"></span>') +
        '</div></div>' +
        '<div class="map-side-scroll"><div class="zone-info" id="zoneInfo" hidden></div><ul class="zone-list" id="zoneList" aria-label="Zones"></ul></div>' +
        '<div class="map-side-section" style="border-top:1px solid var(--line);border-bottom:0"><div class="note" id="mapLegend"></div></div>';

    function toggle(key, label, swatch) {
        return '<label><input type="checkbox" data-layer="' + key + '"' + (state.visible[key] ? ' checked' : '') + '> ' + swatch + ' ' + label + '</label>';
    }

    side.querySelectorAll('[data-layer]').forEach(function (cb) {
        cb.addEventListener('change', function () {
            const k = cb.dataset.layer;
            state.visible[k] = cb.checked;
            if (k === 'boundary') { if (boundary && eng) eng.focusPoblacion(boundary.extent, cb.checked ? boundary.pob : null, { fit: false }); return; }
            state.layers[k]?.setVisible(cb.checked);
        });
    });
    side.querySelectorAll('[data-colorby]').forEach(function (b) {
        b.addEventListener('click', function () {
            state.colorBy = b.dataset.colorby;
            side.querySelectorAll('[data-colorby]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
            render();
        });
    });
    const statusSel = side.querySelector('#mapStatus');
    statusSel.addEventListener('change', function () { state.statusFilter = statusSel.value; render(); });
    const dateInput = side.querySelector('#mapDate');
    if (dateInput) {
        dateInput.addEventListener('change', function () { state.date = dateInput.value || null; poller.refresh(); });
    }

    /* ---------- Map: Poblacion only ---------- */
    const ready = createMap(opts.canvas, { scrollZoom: !!opts.scrollZoom, alive: function () { return alive; } }).then(async function (e) {
        if (!e) return;
        if (!alive) { e.destroy(); return; }
        eng = e;
        LAYERS.forEach(function (k) { state.layers[k] = eng.group(state.visible[k] !== false); });
        const redraw = function () { eng.refreshMask(); };
        document.addEventListener('ecollect:theme', redraw);
        cleanup.push(function () { document.removeEventListener('ecollect:theme', redraw); });
        try {
            boundary = await loadBoundary(opts.boundaryUrl);
            if (!alive) return;
            eng.focusPoblacion(boundary.extent, boundary.pob, { fit: !state.fitted });
            state.fitted = true;
        } catch { if (eng.showMsg) eng.showMsg('The barangay boundary file could not be loaded.'); }
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(function () { eng.resize(); });
            ro.observe(opts.canvas);
            cleanup.push(function () { ro.disconnect(); });
        }
        render();
    });

    /* ---------- Rendering ---------- */
    function zoneColor(z) {
        return state.colorBy === 'zone' ? z.color : (STATUS[z.status] || STATUS.none).color;
    }
    function passes(z) {
        const f = state.statusFilter;
        if (f === 'all') return true;
        if (f === 'pending') return z.status === 'pending' || z.status === 'upcoming';
        return z.status === f;
    }
    function chip(status) {
        const s = STATUS[status] || STATUS.none;
        return '<span class="chip ' + s.css + '">' + esc(s.label) + '</span>';
    }

    function render() {
        const d = state.data;
        if (!d) return;
        renderList();
        renderLegend();
        if (state.selected != null) renderInfo();
        if (!eng) return;
        ['zones', 'routes', 'feedback', 'points', 'emergencies'].forEach(function (k) { state.layers[k].clear(); });

        d.zones.forEach(function (z) {
            if (!passes(z)) return;
            const zc = zoneColor(z);
            const sel = state.selected === z.id;
            const click = function () { select(z.id, true); };
            if (z.boundary && z.boundary.length >= 3) {
                const provisional = /provisional/i.test(z.boundary_source || '');
                eng.polygon(state.layers.zones, z.boundary, { color: zc, weight: sel ? 4 : 2, fillColor: zc,
                    fillOpacity: sel ? .35 : (z.mode === 'drop_off' ? .08 : .18), dashed: provisional, onClick: click, label: esc(z.name) });
            }
            if (z.path && z.path.length) {
                if (z.path.length > 1) {
                    eng.polyline(state.layers.routes, z.path, { color: '#ffffff', weight: sel ? 10 : 7, opacity: .9, onClick: click, zIndex: 3 });
                    eng.polyline(state.layers.routes, z.path, { color: zc, weight: sel ? 6 : 4, opacity: .95, onClick: click, tooltip: esc(z.name) + ' route', zIndex: 4 });
                }
                eng.marker(state.layers.routes, z.path[0], { html: '<div class="zone-pin" style="background:' + zc + '">' + esc(z.number != null ? z.number : '•') + '</div>',
                    size: [28, 28], anchor: [14, 14], title: z.name + ' route start', onClick: click, zIndex: 400 });
            }
        });

        (d.points || []).forEach(function (p) {
            if (p.lat == null) return;
            const served = p.served.join(', ');
            const gmaps = p.maps_url || ('https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng);
            eng.marker(state.layers.points, [p.lat, p.lng], {
                html: '<div class="stop-pin' + (p.today ? ' today' : '') + (p.confirmed ? '' : ' unconfirmed') + '">' + stopSvg + '</div>', size: [30, 30], anchor: [15, 15],
                title: p.name, zIndex: 500,
                popup: '<div class="map-pop"><strong>' + esc(p.name) + '</strong>' +
                    esc(p.days.length ? p.days.map(function (x) { return x.slice(0, 3); }).join(', ') : 'No days set') + ' · ' + esc(p.window) +
                    (p.standby ? '<br>Truck stands by ' + esc(p.standby) + ' min' : '') +
                    '<br>Serves ' + esc(served || 'no zone') +
                    (p.landmark ? '<br><small class="muted">' + esc(p.landmark) + '</small>' : '') +
                    '<br><small class="muted">' + (p.confirmed ? 'Location confirmed by the barangay' : 'Location from a Google Maps reference; not yet confirmed on site') + '</small>' +
                    '<br><a href="' + esc(gmaps) + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div>'
            });
        });

        (d.emergencies || []).forEach(function (e) {
            if (e.lat == null) return;
            const css = e.overdue ? 'overdue' : (e.status === 'Completed' ? 'done' : (e.status === 'Cancelled' ? 'cancelled' : ''));
            eng.marker(state.layers.emergencies, [e.lat, e.lng], {
                html: '<div class="em-pin ' + css + '">!</div>', size: [26, 26], anchor: [13, 13], title: 'Emergency collection', zIndex: 900,
                popup: '<div class="map-pop"><strong>Emergency collection</strong>' + esc(e.status) + (e.overdue ? ' (overdue)' : '') + ' · ' + esc(e.window) +
                    '<br>' + esc(e.location) + ' · ' + esc(e.zone) + '<br>' + esc(e.reason) +
                    '<br><small class="muted">' + esc(e.collector) + (e.truck ? ' · ' + esc(e.truck) : '') + '</small></div>'
            });
        });

        // Trucks are kept between refreshes: they glide to the new GPS position and turn smoothly.
        const seen = new Set();
        d.vehicles.forEach(function (v) {
            seen.add(v.id);
            const g = GPS[v.gps] || GPS.stale;
            const popup = '<div class="map-pop"><strong>' + esc(v.name) + '</strong>' +
                (v.truck ? 'Truck ' + esc(v.truck) + '<br>' : 'No truck assigned<br>') +
                esc(v.zone) + '<br>' + esc(v.duty_text) + '<br>' +
                '<span class="chip ' + (v.gps === 'live' ? 'ongoing' : (v.gps === 'recent' ? 'pending' : '')) + '">' + esc(g.label) + ' · ' + esc(v.ago) + '</span>' +
                '<br><small class="muted">' + esc(g.note) + '</small></div>';
            const heading = v.gps === 'stale' ? null : v.heading;
            let h = trucks.get(v.id);
            if (h && h.gps !== v.gps) { h.setMap(null); trucks.delete(v.id); h = null; }
            if (!h) {
                h = eng.marker(state.layers.vehicles, [v.lat, v.lng], { html: truckMarkerHtml(v.gps, heading), size: [48, 48], anchor: [24, 24], title: v.name, zIndex: 1000, popup: popup });
                h.gps = v.gps;
                trucks.set(v.id, h);
            } else {
                glide(h, v.lat, v.lng, 1500);
                const body = h.getElement() && h.getElement().querySelector('.truck-body');
                if (body && Number.isFinite(heading)) body.style.transform = 'rotate(' + Math.round(heading) + 'deg)';
                if (h.leaflet) h.leaflet.setPopupContent(popup); else if (h.o) h.o.popup = popup;
            }
        });
        trucks.forEach(function (h, id) { if (!seen.has(id)) { h.setMap(null); trucks.delete(id); } });

        d.feedback.forEach(function (f) {
            eng.marker(state.layers.feedback, [f.lat, f.lng], {
                html: '<div class="fb-pin" style="background:' + (f.status === 'In Progress' ? '#a8670e' : '#c2412d') + '"></div>', size: [14, 14], anchor: [7, 7], title: f.type, zIndex: 700,
                popup: '<div class="map-pop"><strong>' + esc(f.type) + '</strong>' + esc(f.status) + ' · ' + esc(f.zone) +
                    (f.description ? '<br>' + esc(f.description.slice(0, 160)) : '') +
                    (f.created_at ? '<br><small class="muted">Reported ' + esc(f.created_at) + '</small>' : '') + '</div>'
            });
        });
    }

    function renderList() {
        const ul = side.querySelector('#zoneList');
        const d = state.data;
        ul.innerHTML = d.zones.map(function (z) {
            if (!passes(z)) return '';
            const s = STATUS[z.status] || STATUS.none;
            return '<li><button type="button" data-zone="' + z.id + '" aria-pressed="' + (state.selected === z.id) + '">' +
                '<span class="zone-badge" style="background:' + z.color + '">' + esc(z.number != null ? z.number : '?') + '</span>' +
                '<span style="flex:1;min-width:0"><strong style="display:block">' + esc(z.name) + '</strong>' +
                '<span class="muted" style="font-size:.75rem">' + (z.mode === 'drop_off' ? 'Drop-off area, no truck stop' : esc((z.days.length ? z.days.map(function (x) { return x.slice(0, 2); }).join('/') + ' ' : '') + z.window)) + '</span></span>' +
                '<span class="chip ' + s.css + '">' + esc(s.label) + '</span></button></li>';
        }).join('') || '<li class="empty"><strong>No zones match</strong><span>Change the "Show zones" filter.</span></li>';
        ul.querySelectorAll('[data-zone]').forEach(function (b) {
            b.addEventListener('click', function () { select(Number(b.dataset.zone), true); });
        });
    }

    function renderLegend() {
        const d = state.data;
        const drawnZones = d.zones.filter(function (z) { return z.boundary && z.boundary.length >= 3; }).length;
        const routes = d.zones.filter(function (z) { return z.path && z.path.length > 1; }).length;
        const live = d.vehicles.filter(function (v) { return v.gps === 'live'; }).length;
        let html = '';
        if (state.colorBy === 'status') {
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' +
                ['completed', 'ongoing', 'pending', 'delayed', 'none'].map(chip).join('') + '</div>';
        }
        const provisional = d.zones.filter(function (z) { return /provisional/i.test(z.boundary_source || ''); }).length;
        const stops = (d.points || []).filter(function (p) { return p.today; }).length;
        html += drawnZones
            ? '<strong>' + drawnZones + '</strong> zone areas shown' + (provisional ? ' (dashed = traced from the barangay zone map, not yet confirmed)' : '') + '. '
            : 'Zone areas are not drawn yet: no zone map has been loaded. ';
        html += '<strong>' + stops + '</strong> truck stop(s) on ' + esc(d.day || 'this day') + '. ';
        if ((d.emergencies || []).length) html += '<strong>' + d.emergencies.length + '</strong> emergency collection(s). ';
        if (routes) html += '<strong>' + routes + '</strong> zone route(s) saved. ';
        html += '<strong>' + d.vehicles.length + '</strong> collector position(s), ' + live + ' live.';
        side.querySelector('#mapLegend').innerHTML = html;
    }

    function select(id, fly) {
        state.selected = state.selected === id && !fly ? null : id;
        render();
        const z = state.data.zones.find(function (x) { return x.id === id; });
        if (z && fly && eng) {
            const pts = (z.boundary && z.boundary.length >= 3 ? z.boundary : []).concat(z.path || []);
            if (pts.length) eng.fit(pts, 40, { maxZoom: 18 });
        }
        if (typeof opts.onZoneSelect === 'function') opts.onZoneSelect(z);
    }

    function stopsFor(z) {
        return (state.data.points || []).filter(function (p) { return p.served_ids.indexOf(z.id) > -1; })
            .map(function (p) { return p.name + ' (' + p.days.map(function (x) { return x.slice(0, 3); }).join('/') + ' ' + p.window + ')'; });
    }

    function renderInfo() {
        const box = side.querySelector('#zoneInfo');
        const z = state.data.zones.find(function (x) { return x.id === state.selected; });
        if (!z) { box.hidden = true; return; }
        box.hidden = false;
        const items = z.items.length
            ? '<ul class="list" style="margin:10px -16px 0">' + z.items.map(function (it) {
                const s = STATUS[it.state] || STATUS.none;
                return '<li><span class="grow"><span class="title">' + esc(it.category) + ' · ' + esc(it.window) + '</span>' +
                    '<span class="meta">' + esc(it.collector) + (it.truck ? ' · ' + esc(it.truck) : '') + (it.late ? ' · completed late' : '') +
                    (it.missed ? '<br>Couldn\'t collect at ' + esc(it.missed.stop) + (it.missed.note ? ': ' + esc(it.missed.note) : '') : '') + '</span></span>' +
                    '<span class="chip ' + s.css + '">' + esc(it.missed ? 'Missed: ' + it.missed.reason : s.label) + '</span></li>';
            }).join('') + '</ul>'
            : '<p class="note" style="margin-top:10px">' + (z.mode === 'drop_off' ? 'Drop-off zone: no truck pickups are scheduled.' : 'No collection scheduled for ' + esc(state.data.date) + '.') + '</p>';
        box.innerHTML =
            '<div style="display:flex;justify-content:space-between;gap:8px;align-items:start">' +
            '<h3>' + esc(z.name) + '</h3><button type="button" class="btn btn-ghost btn-sm" id="zoneInfoClose">Close</button></div>' +
            chip(z.status) +
            '<dl><dt>Collection days</dt><dd>' + esc(z.days.length ? z.days.join(', ') : 'Not set') + '</dd>' +
            '<dt>Time window</dt><dd>' + esc(z.window) + '</dd>' +
            '<dt>Collectors</dt><dd>' + esc(z.collectors.length ? z.collectors.join(', ') : 'None assigned') + '</dd>' +
            (z.mode === 'drop_off' ? '<dt>Collection</dt><dd>Residents bring garbage to the designated place; no truck stop</dd>' : '') +
            '<dt>Truck stops</dt><dd>' + esc(stopsFor(z).join('; ') || 'None') + '</dd>' +
            '<dt>Zone area</dt><dd>' + (z.boundary && z.boundary.length >= 3 ? esc(z.boundary_source || 'Saved') : 'Not drawn yet') + '</dd></dl>' +
            '<p class="note" style="margin-top:12px"><strong>' + esc(state.data.date === state.data.today ? 'Today' : state.data.date) + '</strong></p>' + items;
        box.querySelector('#zoneInfoClose').addEventListener('click', function () { state.selected = null; box.hidden = true; render(); });
    }

    /* ---------- Data ---------- */
    const poller = poll(function () { return opts.load(state.date); }, opts.pollMs || 15000, function (data) {
        if (!alive) return;
        state.data = data;
        if (dateInput && !dateInput.value) dateInput.value = data.date;
        render();
    }, opts.onStatus);

    return {
        ready: ready,
        engine: function () { return eng; },
        refresh: poller.refresh,
        select: function (id) { select(id, true); },
        destroy: function () { alive = false; poller.stop(); cleanup.forEach(function (f) { f(); }); trucks.forEach(function (h) { if (h._anim) cancelAnimationFrame(h._anim); }); if (eng) eng.destroy(); }
    };
}
