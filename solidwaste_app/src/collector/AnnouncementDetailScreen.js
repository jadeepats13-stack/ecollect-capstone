// Collector app: one announcement in full (from Announcements or a notification).
import React from 'react';
import { getAnnouncement } from '../data/collector';
import { useApi } from '../hooks';
import { Screen, StateView } from '../components/ui';
import { AnnouncementView } from '../shared/News';

export default function AnnouncementDetailScreen({ route }) {
  const { id, item } = route.params ?? {};
  const { data, error, loading, reload } = useApi(() => (item ? Promise.resolve(item) : getAnnouncement(id)));
  const a = data ?? item;
  return (
    <Screen style={{ paddingTop: 12 }}>
      {a ? <AnnouncementView a={a} /> : <StateView loading={loading} error={error} onRetry={reload} empty={!loading && !error}
        emptyTitle="Not found" emptyText="This announcement was removed or has ended." />}
    </Screen>
  );
}
