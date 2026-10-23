// Resident app data. Everything comes from Supabase; the server clock decides "today" (Philippine time).
import { supabase, must, currentUserId } from '../lib/supabase';
import { cached, clearCache } from '../lib/cache';
import { parsePath } from '../utils/route';
import { base64ToArrayBuffer } from '../utils/base64';
import { getMapData } from './map';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export { changePassword } from './collector';

export const REPORT_TYPES = ['Missed collection', 'Illegal dumping', 'Overflowing bin', 'Truck concern', 'Suggestion', 'Other'];
export const RATING_TYPE = 'Pickup rating';
const PHOTO_BUCKET = 'report-photos';

/** Zones for sign-up and the profile (readable before login), with their approximate areas. */
export async function getZones() {
  const rows = must(await supabase.from('route').select('route_id, zone_name, boundary_coordinates, collection_mode'));
  const num = (n) => Number(String(n).replace(/\D/g, '')) || 0;
  return rows
    .map((r) => ({ route_id: r.route_id, zone_name: r.zone_name, mode: r.collection_mode, area: parsePath(r.boundary_coordinates) }))
    .sort((a, b) => num(a.zone_name) - num(b.zone_name) || a.zone_name.localeCompare(b.zone_name));
}

export async function getMe() {
  const uid = await currentUserId();
  const me = must(await supabase.from('resident').select('*, route(zone_name, collection_mode)').eq('auth_user_id', uid).maybeSingle());
  if (!me) throw new Error('Resident profile not found.');
  return me;
}

export async function saveMe(f) {
  const uid = await currentUserId();
  if (!f.first_name?.trim() || !f.last_name?.trim()) throw new Error('Enter your first and last name.');
  const row = must(await supabase.from('resident').update({
    first_name: f.first_name.trim(),
    last_name: f.last_name.trim(),
    contact_number: f.contact_number?.trim() || null,
    home_address: f.home_address?.trim() || null,
    route_id: f.route_id ?? null,
  }).eq('auth_user_id', uid).select().maybeSingle());
  if (!row) throw new Error('Could not save your profile.');
  return row;
}

const num = (v) => (v == null ? null : Number(v));

/** Trucks serving my zone that are sharing their location now (collector on shift, GPS in the last 15 minutes). */
export async function getTrucks() {
  const rows = must(await supabase.rpc('resident_trucks')) ?? [];
  return rows.map((t) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(t.recorded_at).getTime()) / 60000));
    return {
      id: t.garbage_collector_id, lat: Number(t.latitude), lng: Number(t.longitude), heading: num(t.heading),
      plate: t.plate_number, minutes: mins, live: mins <= 3,
      title: t.plate_number ? `Garbage truck ${t.plate_number}` : 'Garbage truck',
      sub: mins < 1 ? 'Updated just now' : `Updated ${mins} min ago`,
    };
  });
}

/**
 * Home: { date, day, time, me {zone, mode}, stops[], today {stops[], collected_at}, next[], emergencies[], rated_today,
 *         trucks[], offline, savedAt }.
 */
export async function getHome() {
  const [day, trucks] = await Promise.all([
    cached('home', async () => must(await supabase.rpc('resident_day'))),
    getTrucks().catch(() => []),
  ]);
  return { ...day.data, trucks: day.offline ? [] : trucks, offline: day.offline, savedAt: day.savedAt };
}

/** Truck map: all zones, my zone's stops coloured by today's state, emergency pickups in my zone, live trucks. */
export async function getTruckMap() {
  const [map, day, trucks] = await Promise.all([
    cached('map', getMapData),
    cached('home', async () => must(await supabase.rpc('resident_day'))),
    getTrucks().catch(() => []),
  ]);
  const d = day.data;
  const today = new Map((d.today?.stops ?? []).map((s) => [s.id, s]));
  const fmt = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
  const stops = (d.stops ?? []).filter((s) => s.lat != null).map((s) => {
    const t = today.get(s.id);
    const all = map.data.stops.find((x) => x.id === s.id);
    return {
      id: s.id, name: s.name, landmark: s.landmark, lat: Number(s.lat), lng: Number(s.lng), maps_url: s.maps_url,
      state: t ? t.state : 'off', start: s.start, end: s.end,
      when: `${t ? 'Today' : (s.days ?? []).map((x) => x.slice(0, 3)).join(', ')} ${fmt(s.start)}${s.end ? `–${fmt(s.end)}` : ''}`,
      zones: all?.zones ?? [], url: s.maps_url || `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`,
    };
  });
  const emergencies = (d.emergencies ?? []).filter((e) => e.lat != null && (e.status === 'Scheduled' || e.status === 'In progress')).map((e) => ({
    id: e.id, lat: Number(e.lat), lng: Number(e.lng), location: e.location, reason: e.reason, later: e.date > d.date,
    when: `${e.date === d.date ? 'Today' : e.date} ${fmt(e.start)}${e.end ? `–${fmt(e.end)}` : ''}`,
    url: `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`,
  }));
  return {
    data: { zones: map.data.zones, stops, emergencies },
    me: d.me, date: d.date, trucks: day.offline || map.offline ? [] : trucks, offline: day.offline || map.offline,
  };
}

/** My zone's last `days` days: expected pickups, collected, not collected (with reason), emergency pickups. */
export async function getZoneHistory(days = 30) {
  return (await cached(`history${days}`, async () => must(await supabase.rpc('resident_history', { p_days: days })) ?? [])).data;
}

export async function getAnnouncements() {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const r = await cached('news', async () => must(await supabase.from('announcement').select('announcement_id, title, content, published_timestamp, expiry_date')
    .or(`expiry_date.is.null,expiry_date.gte.${today}`).order('published_timestamp', { ascending: false }).limit(50)));
  return { list: r.data, offline: r.offline };
}

/** One announcement (opened from the list or a notification). Without signal: from the saved list. */
export async function getAnnouncement(id) {
  try {
    return must(await supabase.from('announcement').select('announcement_id, title, content, published_timestamp, expiry_date').eq('announcement_id', id).maybeSingle());
  } catch (e) {
    const saved = await getAnnouncements().catch(() => null);
    const hit = saved?.list?.find((a) => a.announcement_id === Number(id));
    if (hit) return hit;
    throw e;
  }
}

export async function getGuide() {
  return (await cached('guide', async () => must(await supabase.from('waste_category').select('*').order('category_name')))).data;
}

// ---------- Reports ----------
const REPORT_SELECT = 'feedback_report_id, report_type, description, status, created_at, latitude, longitude, response, responded_at, updated_at, resolved_at, photo_path, rating, rating_comment, rating_photo, rated_at, feedback_update(feedback_update_id, status, note, created_at)';

/** Where a report is: sent → seen by the barangay → resolved (or dismissed). */
export function reportStage(r) {
  if (['Resolved', 'Closed'].includes(r.status)) return 'resolved';
  if (r.status === 'Dismissed') return 'dismissed';
  if (r.status !== 'Pending' || r.response || (r.feedback_update ?? []).length) return 'seen';
  return 'sent';
}

const mapReport = (r) => ({
  ...r,
  feedback_update: [...(r.feedback_update ?? [])].sort((a, b) => a.feedback_update_id - b.feedback_update_id),
  stage: reportStage(r),
});

/** My reports, newest first, with a small photo link for the list (one request for all photos). */
export async function getReports() {
  const me = await getMe();
  const rows = must(await supabase.from('feedback_report').select(REPORT_SELECT)
    .eq('resident_id', me.resident_id).neq('report_type', RATING_TYPE).order('created_at', { ascending: false }).limit(100)).map(mapReport);
  const paths = rows.map((r) => r.photo_path).filter(Boolean);
  if (paths.length) {
    const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    const url = Object.fromEntries((data ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
    for (const r of rows) r.thumbUrl = r.photo_path ? url[r.photo_path] ?? null : null;
  }
  return rows;
}

const signed = async (path) => {
  if (!path) return null;
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
};

export async function getReport(id) {
  const r = must(await supabase.from('feedback_report').select(REPORT_SELECT).eq('feedback_report_id', id).maybeSingle());
  if (!r) return null;
  const [photoUrl, ratingPhotoUrl] = await Promise.all([signed(r.photo_path), signed(r.rating_photo)]);
  return { ...mapReport(r), photoUrl, ratingPhotoUrl };
}

/** Can I rate how the barangay handled this report? (resolved or closed, not rated yet) */
export const canRateReport = (r) => !!r && (r.stage === 'resolved' || r.stage === 'dismissed') && r.rating == null;

/** "Rate how the barangay handled this": 1-5 stars, optional comment and proof photo. Once per report. */
export async function rateReport(id, { stars, comment, photo }) {
  if (!stars || stars < 1 || stars > 5) throw new Error('Choose 1 to 5 stars.');
  const path = photo ? await uploadPhoto(photo) : null;
  must(await supabase.rpc('resident_rate_report', { p_report: id, p_stars: stars, p_comment: comment?.trim() || null, p_photo: path }));
}

/**
 * Shrinks a photo (longest side 1280 px, JPEG) and uploads it to my folder in the report-photos bucket.
 * photo: { uri, width, height }. Returns the stored path.
 */
async function uploadPhoto(photo) {
  const uid = await currentUserId();
  const ctx = ImageManipulator.manipulate(photo.uri);
  if ((photo.width ?? 0) >= (photo.height ?? 0)) { if (!photo.width || photo.width > 1280) ctx.resize({ width: 1280, height: null }); }
  else if (photo.height > 1280) ctx.resize({ width: null, height: 1280 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, base64ToArrayBuffer(out.base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`The photo could not be uploaded: ${error.message}`);
  return path;
}

export async function sendReport({ type, description, latitude, longitude, photo }) {
  if (!type) throw new Error('Choose what the report is about.');
  if (!description?.trim() && !photo) throw new Error('Describe the problem or add a photo.');
  const me = await getMe();
  const photo_path = photo ? await uploadPhoto(photo) : null;
  const row = must(await supabase.from('feedback_report').insert({
    resident_id: me.resident_id, report_type: type, description: description?.trim() || null,
    latitude: latitude ?? null, longitude: longitude ?? null, status: 'Pending', photo_path,
  }).select('feedback_report_id').single());
  return row.feedback_report_id;
}

/** "Rate today's pickup": good, or had a problem (with what happened). Once a day. */
export async function ratePickup(good, note = '') {
  const me = await getMe();
  must(await supabase.from('feedback_report').insert({
    resident_id: me.resident_id, report_type: RATING_TYPE,
    description: good ? 'Good' : `Had a problem${note.trim() ? `: ${note.trim()}` : ''}`,
  }));
}

// ---------- Notifications ----------
export async function registerPushToken(token) { must(await supabase.rpc('resident_register_push', { p_token: token })); }
export async function unregisterPushToken(token) { await supabase.rpc('resident_unregister_push', { p_token: token }); }

export { clearCache };
