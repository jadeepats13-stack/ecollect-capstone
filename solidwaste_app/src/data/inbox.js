// Notification inbox (both apps): every alert the server sent to this login, newest first.
import { supabase, must } from '../lib/supabase';

export async function getNotifications(limit = 150) {
  return must(await supabase.from('notification').select('notification_id, title, body, data, created_at, read_at')
    .order('notification_id', { ascending: false }).limit(limit));
}

/** Unread count (null when it can't be checked, e.g. offline). */
export async function countUnreadNotifications() {
  try {
    const { count, error } = await supabase.from('notification').select('notification_id', { count: 'exact', head: true }).is('read_at', null);
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}

/** Marks the given notifications as read, or all of mine when ids is omitted. */
export async function markNotificationsRead(ids) {
  return must(await supabase.rpc('notifications_mark_read', { p_ids: ids?.length ? ids : null }));
}
