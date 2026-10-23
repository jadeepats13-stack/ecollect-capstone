// Google Maps version of the Poblacion map (react-native-maps, Maps SDK for Android).
// Locked to Barangay Poblacion: the camera can't leave the area, everything outside is faded,
// shops/places pins are hidden, and there is a satellite view.
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polygon, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { EXTENT_RING, INITIAL_REGION, MASK_OUTER, POB_RING, centroid, isMapsUrl, panLimits } from './geo';

const TRUCK_IMG = require('../../assets/map/truck.png');
const COLORS = { done: '#1f8a5b', now: '#2563a8', upcoming: '#a8670e', late: '#c2412d', missed: '#c2412d', off: '#75837c' };
const EM_RED = '#c2412d';

// Hide shops, offices, bus stops and other place pins; streets and their names stay.
const NO_PLACES = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
const toLL = (p) => ({ latitude: p[0], longitude: p[1] });

/**
 * Custom-drawn pins are turned into pictures by the map. They must be re-drawn for a moment after
 * they change (otherwise Android can show them blank), then frozen for smooth panning.
 */
function useTrack(key) {
  const [frozenFor, setFrozenFor] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setFrozenFor(key), 1200);
    return () => clearTimeout(t);
  }, [key]);
  return frozenFor !== key;
}

function StopPin({ s }) {
  const size = s.next ? 36 : 30;
  const label = s.state === 'done' ? '✓' : s.state === 'missed' ? '✕' : s.order ? String(s.order) : '⚑';
  return (
    <View style={{ width: size + 10, height: size + 10, alignItems: 'center', justifyContent: 'center' }}>
      {s.next ? <View style={{ position: 'absolute', width: size + 10, height: size + 10, borderRadius: (size + 10) / 2, backgroundColor: 'rgba(31,107,74,0.25)' }} /> : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS[s.state] || COLORS.off, borderWidth: 3, borderColor: '#fff',
        alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: s.next ? 16 : 14 }}>{label}</Text>
      </View>
    </View>
  );
}

function EmPin({ later }) {
  return (
    <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(194,65,45,0.25)' }} />
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: later ? '#fff' : EM_RED, borderWidth: 3, borderColor: later ? EM_RED : '#fff',
        alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: later ? EM_RED : '#fff', fontWeight: '900', fontSize: 16 }}>!</Text>
      </View>
    </View>
  );
}

function ZoneLabel({ name, mine }) {
  return (
    <View style={{ backgroundColor: mine ? '#1f6b4a' : 'rgba(255,255,255,0.85)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', color: mine ? '#fff' : '#14231d' }}>{name.replace('Zone ', 'Z')}</Text>
    </View>
  );
}

const GoogleMap = forwardRef(function GoogleMap({ data, trucks = [], insets = { top: 90, bottom: 200 }, satellite = false, myZone = null,
  onPickStop, showsUserLocation = false, onReady }, ref) {
  const map = useRef(null);
  const markers = useRef({});
  const zones = useMemo(() => (data?.zones ?? []).map((z) => ({
    ...z,
    area: (z.area ?? []).map(toLL),
    path: (z.path ?? []).map(toLL),
  })), [data]);
  const pinsKey = useMemo(() => JSON.stringify([(data?.stops ?? []).map((s) => [s.id, s.state, s.order, s.next]), (data?.emergencies ?? []).map((e) => [e.id, e.later]), myZone]), [data, myZone]);
  const trackPins = useTrack(pinsKey);
  const trucksKey = trucks.map((t) => `${t.id}:${t.live ? 1 : 0}`).join(',');
  const trackTrucks = useTrack(trucksKey);
  // mapPadding (below) already keeps the map clear of the app's panels; this is the extra margin.
  const padding = { top: 12, bottom: 12, left: 16, right: 16 };

  const fitAll = (animated = true) => map.current?.fitToCoordinates(EXTENT_RING, { edgePadding: padding, animated });
  const zoomTo = (latitude, longitude) => map.current?.animateCamera({ center: { latitude, longitude }, zoom: 17.5 }, { duration: 500 });
  useImperativeHandle(ref, () => ({
    fitAll: () => fitAll(true),
    focusStop: (id) => { const s = data?.stops?.find((x) => x.id === id); if (s) { zoomTo(s.lat, s.lng); setTimeout(() => markers.current[`s${id}`]?.showCallout(), 550); } },
    focusEmergency: (id) => { const e = data?.emergencies?.find((x) => x.id === id); if (e) { zoomTo(e.lat, e.lng); setTimeout(() => markers.current[`e${id}`]?.showCallout(), 550); } },
    focusPoint: (lat, lng) => zoomTo(lat, lng),
    focusTruck: (id) => { const t = trucks.find((x) => x.id === id); if (t) zoomTo(t.lat, t.lng); },
  }));

  const ready = () => {
    const lim = panLimits(0.6);
    map.current?.setMapBoundaries(lim.northEast, lim.southWest);
    fitAll(false);
    onReady?.();
  };
  const open = (url) => { if (isMapsUrl(url)) Linking.openURL(url).catch(() => {}); };

  return (
    <MapView
      ref={map}
      provider={PROVIDER_GOOGLE}
      style={{ flex: 1 }}
      initialRegion={INITIAL_REGION}
      mapType={satellite ? 'hybrid' : 'standard'}
      customMapStyle={NO_PLACES}
      showsPointsOfInterests={false}
      showsBuildings={false}
      showsIndoors={false}
      showsTraffic={false}
      toolbarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      showsCompass={false}
      showsMyLocationButton={false}
      showsUserLocation={showsUserLocation}
      minZoomLevel={14}
      maxZoomLevel={20}
      mapPadding={{ top: insets.top, bottom: insets.bottom, left: 0, right: 0 }}
      onMapReady={ready}
    >
      {/* Everything outside Poblacion faded */}
      <Polygon coordinates={MASK_OUTER} holes={[EXTENT_RING]} strokeWidth={0} fillColor={satellite ? 'rgba(0,0,0,0.5)' : 'rgba(238,241,237,0.72)'} tappable={false} zIndex={1} />
      <Polyline coordinates={[...POB_RING, POB_RING[0]]} strokeColor={satellite ? '#ffffff' : '#14231d'} strokeWidth={3} zIndex={2} />

      {zones.map((z) => {
        const mine = myZone && z.name === myZone;
        const c = centroid(z.area);
        return (
          <React.Fragment key={`z${z.id}`}>
            {z.area.length > 2 ? (
              <>
                <Polygon coordinates={z.area} strokeWidth={0} fillColor={mine ? 'rgba(31,107,74,0.16)' : 'rgba(31,107,74,0.06)'} tappable={false} zIndex={3} />
                <Polyline coordinates={[...z.area, z.area[0]]} strokeColor={mine ? '#1f6b4a' : satellite ? '#ffffff' : '#4b5a53'} strokeWidth={mine ? 2.5 : 1.5} lineDashPattern={[10, 8]} zIndex={4} />
              </>
            ) : null}
            {z.path.length > 1 ? <Polyline coordinates={z.path} strokeColor="#1f6b4a" strokeWidth={4} zIndex={5} /> : null}
            {c ? (
              <Marker coordinate={c} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={trackPins} tappable={false} zIndex={6}>
                <ZoneLabel name={z.name} mine={mine} />
              </Marker>
            ) : null}
          </React.Fragment>
        );
      })}

      {(data?.stops ?? []).map((s) => (
        <Marker key={`s${s.id}`} ref={(m) => { markers.current[`s${s.id}`] = m; }}
          coordinate={{ latitude: s.lat, longitude: s.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={trackPins} zIndex={s.next ? 30 : 20}
          title={s.name} description={[s.when, s.zones?.length ? `Serves ${s.zones.join(', ')}` : '', s.url ? 'Tap for directions' : ''].filter(Boolean).join(' · ')}
          onPress={() => onPickStop?.(s.id)} onCalloutPress={() => open(s.url)}>
          <StopPin s={s} />
        </Marker>
      ))}

      {(data?.emergencies ?? []).map((e) => (
        <Marker key={`e${e.id}`} ref={(m) => { markers.current[`e${e.id}`] = m; }}
          coordinate={{ latitude: e.lat, longitude: e.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={trackPins} zIndex={40}
          title={`Emergency pickup: ${e.location}`} description={[e.when, e.reason, e.url ? 'Tap for directions' : ''].filter(Boolean).join(' · ')}
          onCalloutPress={() => open(e.url)}>
          <EmPin later={e.later} />
        </Marker>
      ))}

      {trucks.map((t) => (
        <React.Fragment key={`t${t.id}`}>
          {t.live ? <Circle center={{ latitude: t.lat, longitude: t.lng }} radius={22} strokeWidth={0} fillColor="rgba(31,107,74,0.22)" zIndex={49} /> : null}
          <Marker coordinate={{ latitude: t.lat, longitude: t.lng }} anchor={{ x: 0.5, y: 0.5 }} flat
            rotation={t.heading != null && t.heading >= 0 ? t.heading : 0} tracksViewChanges={trackTrucks} zIndex={50}
            title={t.title} description={t.sub}>
            <View style={{ width: 30, height: 42, alignItems: 'center', justifyContent: 'center', opacity: t.live ? 1 : 0.55 }}>
              <Image source={TRUCK_IMG} style={{ width: 26, height: 38 }} resizeMode="contain" fadeDuration={0} />
            </View>
          </Marker>
        </React.Fragment>
      ))}
    </MapView>
  );
});

export default GoogleMap;
