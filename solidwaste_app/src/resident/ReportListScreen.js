// Resident app, Report: my reports with their progress (sent → seen → resolved), filters, and the New button at the top right.
import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { canRateReport, getReports } from '../data/resident';
import { useApi } from '../hooks';
import { Card, FilterChips, Screen, StateView } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { Header, IconCircle } from '../collector/parts';
import { STAGE, StageBar, TYPE_ICONS } from './ReportParts';
import { dayName, phClock } from './status';

const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const sent = (ts) => `${dayName(new Date(new Date(ts).getTime() + 8 * 3600000).toISOString().slice(0, 10), today(), false)}, ${phClock(ts)}`;

function NewButton({ onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="New report"
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 9, paddingHorizontal: 14, opacity: pressed ? 0.85 : 1 }, shadow.card]}>
      <Ionicons name="add" size={19} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, marginLeft: 4 }}>New</Text>
    </Pressable>
  );
}

function ReportCard({ r, onPress }) {
  const st = STAGE[r.stage];
  const rate = canRateReport(r);
  return (
    <Card onPress={onPress} style={{ padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {r.thumbUrl ? (
          <Image source={{ uri: r.thumbUrl }} style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surface2 }} accessibilityLabel="Photo sent with the report" />
        ) : <IconCircle name={TYPE_ICONS[r.report_type] ?? 'chatbubble-ellipses-outline'} size={52} />}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontSize: 16, fontWeight: '800', color: colors.text }} numberOfLines={1}>{r.report_type}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </View>
          <Text style={[type.small, { color: colors.text, marginTop: 2 }]} numberOfLines={2}>{r.description || 'Photo only'}</Text>
          <Text style={{ fontSize: 12.5, color: colors.faint, marginTop: 3 }}>#{r.feedback_report_id} · {sent(r.created_at)}</Text>
        </View>
      </View>
      <StageBar stage={r.stage} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7 }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: st.fg }}>{st.label}</Text>
        {r.response ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
            <Ionicons name="chatbubble" size={13} color={colors.primary} />
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.primary, marginLeft: 4 }}>Reply</Text>
          </View>
        ) : null}
        {rate ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fdf3d6', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 }}>
            <Ionicons name="star" size={12} color="#b98500" />
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#8a6400', marginLeft: 3 }}>Rate</Text>
          </View>
        ) : r.rating ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
            <Ionicons name="star" size={13} color="#e0a100" />
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.muted, marginLeft: 3 }}>{r.rating}/5</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export default function ReportListScreen({ navigation }) {
  const { data, error, loading, refreshing, reload, pull } = useApi(getReports);
  const [filter, setFilter] = useState('all');
  const list = data ?? [];
  const groups = {
    all: list,
    open: list.filter((r) => r.stage === 'sent' || r.stage === 'seen'),
    done: list.filter((r) => r.stage === 'resolved' || r.stage === 'dismissed'),
    rate: list.filter(canRateReport),
  };
  const shown = groups[filter];
  const goNew = () => navigation.navigate('ReportNew');
  const EMPTY = {
    all: ['No reports yet', 'Missed pickup, illegal dumping, an overflowing bin… Tap New to tell the barangay.'],
    open: ['Nothing open', 'Reports waiting for the barangay appear here.'],
    done: ['Nothing resolved yet', 'Reports the barangay resolved or closed appear here.'],
    rate: ['Nothing to rate', 'When the barangay resolves a report, you can rate how it was handled.'],
  }[filter];

  return (
    <Screen refreshing={refreshing} onRefresh={pull}>
      <Header title="Report" sub="To Barangay Poblacion" right={<NewButton onPress={goNew} />} />
      {data && list.length ? (
        <FilterChips value={filter} onChange={setFilter}
          options={[['all', 'All', groups.all.length], ['open', 'Open', groups.open.length], ['done', 'Resolved', groups.done.length], ['rate', 'To rate', groups.rate.length]]} />
      ) : null}
      <StateView loading={loading} error={error} onRetry={reload} empty={data && shown.length === 0} emptyTitle={EMPTY[0]} emptyText={EMPTY[1]} />
      {shown.map((r) => <ReportCard key={r.feedback_report_id} r={r} onPress={() => navigation.navigate('ReportDetail', { id: r.feedback_report_id })} />)}
    </Screen>
  );
}