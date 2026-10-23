// Announcements from the barangay (both apps): searchable list of short previews, and the full post.
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Card, SearchBox, StateView } from '../components/ui';
import { colors, radius, type } from '../theme';
import { fmtDateTime } from '../utils/schedule';
import { IconCircle } from '../collector/parts';

export const SEEN_KEY = 'ecollect-announcements-seen';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

function NewTag() {
  return (
    <View style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 6 }}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>NEW</Text>
    </View>
  );
}

/**
 * list: announcements (newest first). onOpen(a): show one. markRead(newestId): clears the badge.
 * Posts newer than the last visit are marked NEW.
 */
export function AnnouncementList({ list, loading, error, onRetry, onOpen, markRead, offline }) {
  const [search, setSearch] = useState('');
  const [seenBefore, setSeenBefore] = useState(null);
  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY).then((v) => setSeenBefore(Number(v) || 0)).catch(() => setSeenBefore(0));
  }, []);
  const items = useMemo(() => list ?? [], [list]);
  useEffect(() => {
    if (items.length && seenBefore !== null) markRead?.(Math.max(...items.map((a) => a.announcement_id)));
  }, [items, seenBefore, markRead]);
  const q = search.trim().toLowerCase();
  const shown = q ? items.filter((a) => `${a.title} ${a.content}`.toLowerCase().includes(q)) : items;

  return (
    <>
      {items.length > 2 || q ? <SearchBox value={search} onChangeText={setSearch} placeholder="Search announcements" /> : null}
      {offline ? <Text style={[type.small, { color: colors.amber, marginBottom: 10 }]}>No internet. Showing what was saved on this phone.</Text> : null}
      <StateView loading={loading} error={error} onRetry={onRetry}
        empty={list && shown.length === 0}
        emptyTitle={q ? 'No matches' : 'No announcements'}
        emptyText={q ? `No announcement mentions “${search.trim()}”.` : 'Announcements from your barangay appear here.'} />
      {shown.map((a) => {
        const isNew = seenBefore !== null && a.announcement_id > seenBefore;
        return (
          <Card key={a.announcement_id} onPress={() => onOpen(a)} style={[{ flexDirection: 'row', alignItems: 'flex-start' }, isNew ? { borderColor: colors.primaryMid, borderWidth: 1.5 } : null]}>
            <IconCircle name="megaphone-outline" size={38} />
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[type.heading, { flex: 1, fontSize: 16.5 }]} numberOfLines={2}>{a.title}</Text>
                {isNew ? <NewTag /> : null}
              </View>
              <Text style={[type.small, { color: colors.faint, marginTop: 2 }]}>{fmtDateTime(a.published_timestamp)}</Text>
              <Text style={[type.small, { marginTop: 6, color: colors.text }]} numberOfLines={2}>{a.content}</Text>
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13.5, marginTop: 6 }}>Read more ›</Text>
            </View>
          </Card>
        );
      })}
    </>
  );
}

/** The full announcement. */
export function AnnouncementView({ a }) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <IconCircle name="megaphone" size={44} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={type.overline}>Announcement · Barangay Poblacion</Text>
          <Text style={[type.small, { marginTop: 2 }]}>Posted {fmtDateTime(a.published_timestamp)}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 23, fontWeight: '800', color: colors.text, lineHeight: 29, marginBottom: 12 }} accessibilityRole="header">{a.title}</Text>
      {a.expiry_date ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.amberLight, borderRadius: radius.md, padding: 10, marginBottom: 14 }}>
          <Ionicons name="time-outline" size={18} color={colors.amber} />
          <Text style={{ marginLeft: 8, fontSize: 14.5, color: colors.text }}>Applies until {fmtDay(a.expiry_date)}</Text>
        </View>
      ) : null}
      <Card>
        <Text style={[type.body, { fontSize: 16.5, lineHeight: 25 }]} selectable>{a.content}</Text>
      </Card>
    </>
  );
}

