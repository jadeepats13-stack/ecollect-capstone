// Resident app: one report — status banner, what I sent, the barangay's reply, my rating of how it was
// handled (once resolved or closed), and every update.
import React, { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { canRateReport, getReport, rateReport } from '../data/resident';
import { useApi } from '../hooks';
import { Button, Card, ErrorBanner, Screen, StateView } from '../components/ui';
import { colors, radius, type } from '../theme';
import { fmtDateTime } from '../utils/schedule';
import { LinkButton, openInMaps } from '../collector/parts';
import PhotoViewer from '../shared/PhotoViewer';
import { STAGE, STAR_LABELS, Stars, TYPE_ICONS, Tracker } from './ReportParts';
import PhotoPicker from './PhotoPicker';

const STAGE_ICON = { sent: 'paper-plane', seen: 'eye', resolved: 'checkmark-circle', dismissed: 'close-circle' };
const STAGE_TEXT = {
  sent: 'The barangay office has your report. You’ll be notified when they look at it.',
  seen: 'The barangay is working on it.',
  resolved: 'The barangay marked this as resolved.',
  dismissed: 'The barangay closed this report without action.',
};

function Section({ title, icon, children, style }) {
  return (
    <Card style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        {icon ? <Ionicons name={icon} size={18} color={colors.muted} style={{ marginRight: 6 }} /> : null}
        <Text style={[type.overline, { color: colors.muted }]}>{title}</Text>
      </View>
      {children}
    </Card>
  );
}

function RateForm({ id, onDone }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!stars) return setError('Tap the stars to rate.');
    setBusy(true); setError('');
    try {
      await rateReport(id, { stars, comment, photo });
      onDone();
      Alert.alert('Thank you', 'Your rating was sent to the barangay.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Rate how the barangay handled this" icon="star-outline" style={{ borderColor: '#f0d98a', borderWidth: 1.5 }}>
      <Stars value={stars} onChange={setStars} size={36} gap={10} />
      <Text style={{ fontSize: 14, fontWeight: '700', color: stars ? colors.text : colors.faint, marginTop: 6 }}>{stars ? STAR_LABELS[stars] : 'Tap a star'}</Text>
      <TextInput value={comment} onChangeText={setComment} multiline maxLength={1000} placeholder="Comment (optional): was the problem really fixed?"
        placeholderTextColor="#9aa59a" accessibilityLabel="Comment"
        style={{ backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12, minHeight: 80,
          fontSize: 15.5, color: colors.text, textAlignVertical: 'top', marginTop: 12, marginBottom: 12 }} />
      <Text style={[type.label, { marginBottom: 8 }]}>Photo as proof <Text style={{ color: colors.faint, fontWeight: '400' }}>(optional)</Text></Text>
      <PhotoPicker photo={photo} onChange={setPhoto} />
      <View style={{ height: 12 }} />
      <ErrorBanner message={error} />
      <Button title="Send rating" icon="star" onPress={send} loading={busy} />
    </Section>
  );
}

export default function ReportDetailScreen({ route }) {
  const id = route.params?.id;
  const { data: r, error, loading, refreshing, reload, pull } = useApi(() => getReport(id));
  if (!r) {
    return (
      <Screen style={{ paddingTop: 12 }}>
        <StateView loading={loading} error={error} onRetry={reload} empty={!loading && !error} emptyTitle="Not found" emptyText="This report could not be found." />
      </Screen>
    );
  }
  const st = STAGE[r.stage];
  const updates = r.feedback_update.filter((u) => u.status || u.note);
  return (
    <Screen refreshing={refreshing} onRefresh={pull} style={{ paddingTop: 12 }}>
      {route.params?.sent && r.stage === 'sent' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.doneLight, borderRadius: radius.md, padding: 12, marginBottom: 12 }}>
          <Ionicons name="checkmark-circle" size={20} color={colors.done} />
          <Text style={{ flex: 1, marginLeft: 8, fontSize: 14.5, color: colors.text }}>Report sent. You can follow it here and in the Report tab.</Text>
        </View>
      ) : null}

      <View style={{ backgroundColor: st.bg, borderRadius: radius.xl, padding: 16, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={TYPE_ICONS[r.report_type] ?? 'chatbubble-ellipses-outline'} size={22} color={st.fg} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[type.overline, { color: st.fg }]}>{r.report_type} · #{r.feedback_report_id}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <Ionicons name={STAGE_ICON[r.stage]} size={20} color={st.fg} />
              <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, marginLeft: 6 }}>{st.label}</Text>
            </View>
          </View>
        </View>
        <Text style={[type.small, { color: colors.text, marginTop: 10 }]}>{STAGE_TEXT[r.stage]}</Text>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 10, marginTop: 12 }}>
          <Tracker stage={r.stage} />
        </View>
      </View>

      {r.response ? (
        <Section title="Reply from the barangay" icon="chatbubble-outline" style={{ backgroundColor: colors.primaryLight, borderColor: colors.primaryMid }}>
          <Text style={[type.body, { fontSize: 16 }]}>{r.response}</Text>
          {r.responded_at ? <Text style={[type.small, { marginTop: 8 }]}>{fmtDateTime(r.responded_at)}</Text> : null}
        </Section>
      ) : null}

      {canRateReport(r) ? <RateForm id={r.feedback_report_id} onDone={reload} /> : null}
      {r.rating ? (
        <Section title="Your rating" icon="star-outline">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Stars value={r.rating} size={24} />
            <Text style={{ fontWeight: '800', color: colors.text, marginLeft: 6 }}>{STAR_LABELS[r.rating]}</Text>
          </View>
          {r.rating_comment ? <Text style={[type.body, { marginTop: 8 }]}>{r.rating_comment}</Text> : null}
          {r.ratingPhotoUrl ? <View style={{ marginTop: 10 }}><PhotoViewer uri={r.ratingPhotoUrl} label="Photo sent with the rating" /></View> : null}
          {r.rated_at ? <Text style={[type.small, { marginTop: 8 }]}>{fmtDateTime(r.rated_at)}</Text> : null}
        </Section>
      ) : null}

      <Section title="What you sent" icon="document-text-outline">
        <Text style={[type.body, { fontSize: 16 }]}>{r.description || 'No description.'}</Text>
        {r.photoUrl ? <View style={{ marginTop: 12 }}><PhotoViewer uri={r.photoUrl} label="Photo sent with the report" /></View>
          : r.photo_path ? <Text style={[type.small, { marginTop: 8 }]}>A photo was sent (it can’t be shown right now).</Text> : null}
        {r.latitude != null ? <LinkButton icon="location-outline" title="Place on the map" onPress={() => openInMaps({ lat: r.latitude, lng: r.longitude })} /> : null}
        <Text style={[type.small, { marginTop: r.latitude != null ? 0 : 10 }]}>Sent {fmtDateTime(r.created_at)}</Text>
      </Section>

      <Section title="Updates" icon="time-outline">
        {[{ key: 'sent', title: 'You sent the report', at: r.created_at }, ...updates.map((u) => ({
          key: u.feedback_update_id,
          title: u.status ? `Status: ${u.status === 'Dismissed' ? 'Closed without action' : u.status}` : 'The barangay replied',
          note: u.note, at: u.created_at,
        }))].reverse().map((u, i, all) => (
          <View key={u.key} style={{ flexDirection: 'row' }}>
            <View style={{ width: 20, alignItems: 'center' }}>
              <View style={{ width: 11, height: 11, borderRadius: 6, marginTop: 4, backgroundColor: i === 0 ? st.fg : colors.borderStrong }} />
              {i < all.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: colors.line, marginVertical: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, marginLeft: 8, paddingBottom: i < all.length - 1 ? 14 : 0 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{u.title}</Text>
              {u.note ? <Text style={type.small}>{u.note}</Text> : null}
              <Text style={[type.small, { color: colors.faint }]}>{fmtDateTime(u.at)}</Text>
            </View>
          </View>
        ))}
      </Section>
    </Screen>
  );
}
