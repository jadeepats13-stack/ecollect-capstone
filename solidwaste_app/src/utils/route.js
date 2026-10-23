/**
 * route.path_coordinates is a text column holding JSON. Accepts
 *   [{latitude, longitude}] | [{lat, lng}] | [[lat, lng]] | [[lng, lat]]
 * and always returns [{latitude, longitude}].
 */
export function parsePath(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v
    .map((p) => {
      if (Array.isArray(p)) {
        const [a, b] = p.map(Number);
        // Pairs: whichever number can be a latitude (|x| <= 90) while the other cannot is the latitude.
        return Math.abs(a) <= 90 && Math.abs(b) > 90 ? { latitude: a, longitude: b } : { latitude: b, longitude: a };
      }
      return { latitude: Number(p?.latitude ?? p?.lat), longitude: Number(p?.longitude ?? p?.lng ?? p?.lon) };
    })
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
}

/** [{latitude, longitude}] -> JSON text for route.path_coordinates */
export function serializePath(points) {
  return JSON.stringify((points ?? []).map((p) => ({ latitude: p.latitude, longitude: p.longitude })));
}
