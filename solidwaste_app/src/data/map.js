// Map data shared by the collector and resident apps: zone areas/paths and truck stops (with the zones they serve).
import { supabase, must } from '../lib/supabase';
import { parsePath } from '../utils/route';

export async function getMapData() {
  const [routes, points, links] = await Promise.all([
    supabase.from('route').select('route_id, zone_name, boundary_coordinates, path_coordinates, collection_mode'),
    supabase.from('collection_point').select('collection_point_id, name, landmark, latitude, longitude, maps_url, collection_days, start_time, end_time, is_active'),
    supabase.from('collection_point_zone').select('collection_point_id, route_id'),
  ]);
  const zoneName = Object.fromEntries(must(routes).map((r) => [r.route_id, r.zone_name]));
  const servedBy = {}, zoneIds = {};
  for (const l of must(links)) {
    (servedBy[l.collection_point_id] ??= []).push(zoneName[l.route_id]);
    (zoneIds[l.collection_point_id] ??= []).push(l.route_id);
  }
  return {
    zones: must(routes).map((r) => ({
      id: r.route_id, name: r.zone_name, mode: r.collection_mode === 'drop_off' ? 'drop_off' : 'truck',
      area: parsePath(r.boundary_coordinates).map((p) => [p.latitude, p.longitude]),
      path: parsePath(r.path_coordinates).map((p) => [p.latitude, p.longitude]),
    })),
    stops: must(points).filter((p) => p.is_active && p.latitude != null).map((p) => ({
      id: p.collection_point_id, name: p.name, landmark: p.landmark, lat: Number(p.latitude), lng: Number(p.longitude),
      maps_url: p.maps_url, days: p.collection_days, start: p.start_time, end: p.end_time,
      zones: (servedBy[p.collection_point_id] ?? []).filter(Boolean),
      zone_ids: zoneIds[p.collection_point_id] ?? [],
    })),
  };
}
