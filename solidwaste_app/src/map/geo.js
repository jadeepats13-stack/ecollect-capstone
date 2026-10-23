// Shapes of Barangay Poblacion used by both map kinds (Google Maps and the Leaflet fallback).
import boundary from './poblacionBoundary.json';

const feature = (kind) => boundary.features.find((f) => f.properties.kind === kind);
export const POB = feature('barangay_boundary');
/** Barangay boundary plus the traced zone areas: everything outside it is faded. */
export const EXTENT = feature('display_extent') || POB;

const toLatLng = ([lng, lat]) => ({ latitude: lat, longitude: lng });
export const POB_RING = POB.geometry.coordinates[0].map(toLatLng);
export const EXTENT_RING = EXTENT.geometry.coordinates[0].map(toLatLng);

const lats = EXTENT_RING.map((p) => p.latitude), lngs = EXTENT_RING.map((p) => p.longitude);
export const BOUNDS = { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) };
export const CENTER = { latitude: (BOUNDS.south + BOUNDS.north) / 2, longitude: (BOUNDS.west + BOUNDS.east) / 2 };
export const INITIAL_REGION = {
  ...CENTER,
  latitudeDelta: (BOUNDS.north - BOUNDS.south) * 1.4,
  longitudeDelta: (BOUNDS.east - BOUNDS.west) * 1.4,
};

/** How far the camera may move: the barangay plus a margin (fraction of its size). */
export function panLimits(margin = 0.6) {
  const dLat = (BOUNDS.north - BOUNDS.south) * margin, dLng = (BOUNDS.east - BOUNDS.west) * margin;
  return {
    northEast: { latitude: BOUNDS.north + dLat, longitude: BOUNDS.east + dLng },
    southWest: { latitude: BOUNDS.south - dLat, longitude: BOUNDS.west - dLng },
  };
}

/** A box well around the barangay with Poblacion cut out: drawn faded over everything else. */
export const MASK_OUTER = (() => {
  const d = 0.25;
  return [
    { latitude: BOUNDS.south - d, longitude: BOUNDS.west - d }, { latitude: BOUNDS.north + d, longitude: BOUNDS.west - d },
    { latitude: BOUNDS.north + d, longitude: BOUNDS.east + d }, { latitude: BOUNDS.south - d, longitude: BOUNDS.east + d },
  ];
})();

/** Centre of a polygon's points (good enough for a label inside a small zone). */
export function centroid(points) {
  if (!points?.length) return null;
  let la = 0, ln = 0;
  for (const p of points) { la += p.latitude; ln += p.longitude; }
  return { latitude: la / points.length, longitude: ln / points.length };
}

/** Is the point inside the polygon? (ray casting; points as {latitude, longitude}) */
export function insidePolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.latitude > pt.latitude) !== (b.latitude > pt.latitude)
      && pt.longitude < ((b.longitude - a.longitude) * (pt.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude) inside = !inside;
  }
  return inside;
}

export const directionsUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
export const isMapsUrl = (u) => /^https:\/\/(www\.)?google\.[a-z.]+\/maps|^https:\/\/maps\.app\.goo\.gl\//.test(u || '');

/** Direction of travel between two {latitude, longitude} points, degrees from north. */
export function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.longitude - a.longitude) * r) * Math.cos(b.latitude * r);
  const x = Math.cos(a.latitude * r) * Math.sin(b.latitude * r) - Math.sin(a.latitude * r) * Math.cos(b.latitude * r) * Math.cos((b.longitude - a.longitude) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Which zone is this point in? { zone } | { outside: true } | { none: true } (zone areas are approximate). */
export function zoneAt(zones, latitude, longitude) {
  const pt = { latitude, longitude };
  const hit = zones.find((z) => z.area.length > 2 && insidePolygon(pt, z.area));
  if (hit) return { zone: hit };
  if (!insidePolygon(pt, EXTENT_RING)) return { outside: true };
  return { none: true };
}
