// Resident app, News: announcements from the barangay — search, short previews, tap to read the full post.
import React from 'react';
import { getAnnouncements } from '../data/resident';
import { useApi } from '../hooks';
import { Screen } from '../components/ui';
import { Header } from '../collector/parts';
import { AnnouncementList } from '../shared/News';
import { useResidentServices } from './ResidentServices';

export default function NewsScreen({ navigation }) {
  const { data, error, loading, refreshing, reload, pull } = useApi(getAnnouncements);
  const { markRead } = useResidentServices();
  return (
    <Screen refreshing={refreshing} onRefresh={pull}>
      <Header title="News" sub="From Barangay Poblacion" right={null} />
      <AnnouncementList list={data?.list} offline={data?.offline} loading={loading} error={error} onRetry={reload} markRead={markRead}
        onOpen={(a) => navigation.navigate('NewsDetail', { id: a.announcement_id, item: a })} />
    </Screen>
  );
}
