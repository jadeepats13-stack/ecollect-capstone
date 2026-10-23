// Map panel (map canvas + side panel), port of includes/map_panel.php.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { mountZoneMap } from '../lib/zoneMap';
import { loadMap } from '../lib/ops';
import { usePanel } from './Layout';

const ZoneMapPanel = forwardRef(function ZoneMapPanel({ title, desc, full = false, showFeedback = false, actions = null, live = true }, ref) {
  const canvas = useRef(null);
  const side = useRef(null);
  const api = useRef(null);
  const panel = usePanel();

  useEffect(() => {
    api.current = mountZoneMap({
      canvas: canvas.current, side: side.current,
      load: (date) => loadMap(date),
      boundaryUrl: '/data/poblacion_boundary.geojson',
      // The Live map refreshes every 10 s (trucks glide between readings).
      pollMs: full ? 10000 : 15000, dateFilter: true, scrollZoom: full, showFeedback,
      onStatus: live ? (s) => panel?.setLive(s) : undefined,
    });
    return () => { api.current?.destroy(); api.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    select: (id) => { api.current?.select(id); canvas.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    refresh: () => api.current?.refresh(),
  }), []);

  return (
    <section className={`panel${full ? '' : ' mb'}`} aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="panel-tools">{actions}</div>
        {desc ? <p>{desc}</p> : null}
      </div>
      <div className={`map-shell${full ? ' full' : ''}`} style={{ marginTop: 12 }}>
        <div className="map-canvas" ref={canvas} role="region" aria-label="Map of Barangay Poblacion" />
        <aside className="map-side" ref={side} aria-label="Map filters and zone details" />
      </div>
    </section>
  );
});

export default ZoneMapPanel;
