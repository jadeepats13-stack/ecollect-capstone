// Collector app: announcements from the barangay — search, short previews, tap to read the full post.
import React from 'react';
import { getAnnouncements } from '../data/collector';
import { useApi } from '../hooks';
import { Screen } from '../components/ui';
import { AnnouncementList } from '../shared/News';
import { useCollectorServices } from './CollectorServices';

export default function CollectorAnnouncementsScreen({ navigation }) {
  const { data, error, loading, refreshing, reload, pull } = useApi(getAnnouncements);
  const { markRead } = useCollectorServices();
  return (
    <Screen refreshing={refreshing} onRefresh={pull} style={{ paddingTop: 12 }}>
      <AnnouncementList list={data} loading={loading} error={error} onRetry={reload} markRead={markRead}
        onOpen={(a) => navigation.navigate('AnnouncementDetail', { id: a.announcement_id, item: a })} />
    </Screen>
  );
}
