// Fallback Poblacion map (Leaflet in a WebView) for builds without a Google Maps key.
// Same props and commands as GoogleMap.
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { mapHtml } from './mapHtml';
import { isMapsUrl } from './geo';

const LeafletMap = forwardRef(function LeafletMap({ data, trucks = [], insets = { top: 90, bottom: 200 }, satellite = false, myZone = null, onPickStop, onReady }, ref) {
  const web = useRef(null);
  const [readyFor, setReadyFor] = useState(null);
  // The page is built once per data set; trucks and the satellite switch are pushed in afterwards.
  const [firstSatellite] = useState(satellite);
  const html = useMemo(() => (data ? mapHtml(data, { insets, myZone, satellite: firstSatellite }) : null), [data, insets, myZone, firstSatellite]);
  const ready = readyFor !== null && readyFor === html;
  const js = (code) => web.current?.injectJavaScript(`try { ${code} } catch (e) {} true;`);

  useEffect(() => { if (ready) js(`window.setTrucks(${JSON.stringify(trucks)})`); }, [ready, trucks]);
  useEffect(() => { if (ready) js(`window.setSatellite(${satellite ? 'true' : 'false'})`); }, [ready, satellite]);

  useImperativeHandle(ref, () => ({
    fitAll: () => js('window.fitAll()'),
    focusStop: (id) => js(`window.focusStop(${Number(id)})`),
    focusEmergency: (id) => js(`window.focusEmergency(${Number(id)})`),
    focusPoint: (lat, lng) => js(`window.focusPoint(${Number(lat)}, ${Number(lng)})`),
    focusTruck: (id) => js(`window.focusTruck(${JSON.stringify(id)})`),
  }));

  const onMessage = (e) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.ready) { setReadyFor(html); onReady?.(); }
      if (m.picked != null) onPickStop?.(m.picked);
      if (m.open && isMapsUrl(m.open)) Linking.openURL(m.open).catch(() => {});
    } catch { /* ignore */ }
  };

  if (!html) return null;
  return (
    <WebView
      ref={web}
      originWhitelist={['*']}
      source={{ html, baseUrl: 'https://ecollect.app/' }}
      onMessage={onMessage}
      javaScriptEnabled
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(req) => req.url.startsWith('https://ecollect.app') || req.url === 'about:blank'}
      style={{ flex: 1, backgroundColor: '#eef1ed' }}
    />
  );
});

export default LeafletMap;
