// Collector app: today's duty (shift + GPS), truck stops, emergency pickups.
import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDay, markOther, setEmergencyStatus, shiftAction, stopAction } from '../data/collector';
import { useApi, useNow } from '../hooks';
import { Button, Card, Screen, StateView } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { fmtRange, fmtTime } from '../utils/schedule';
import { useLocationShare } from './LocationShare';
import { GpsPill, Header, IconCircle, LinkButton, SectionTitle, ShiftLock, StateTag, ZoneChips, openInMaps } from './parts';
import { useCollectorServices } from './CollectorServices';
import Bell from '../shared/Bell';
import { clearFailed, subscribeOutbox } from './offline';
import { endStandby, standbyLeft, startStandby, subscribeArrivals } from './arrival';
import { scheduleFirstStopReminder } from './notify';
import { LoadSheet, MissedSheet, loadText } from './sheets';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso, day) => { const [, m, d] = String(iso).split('-').map(Number); return `${day} · ${MONTHS[m - 1]} ${d}`; };
/** Philippine clock time of a timestamp ("5:12 PM"). */
const clock = (ts) => { if (!ts) return ''; const d = new Date(new Date(ts).getTime() + 8 * 3600000); return fmtTime(`${d.getUTCHours()}:${d.getUTCMinutes()}:00`); };
const mmss = (sec) => `${Math.floor(Math.abs(sec) / 60)}:${String(Math.abs(sec) % 60).padStart(2, '0')}`;

function useStore(subscribe, initial) {
  const [v, setV] = useState(initial);
  useEffect(() => subscribe(setV), [subscribe]);
  return v;
}

function Notice({ icon, tone = 'amber', children, action }) {
  const t = { amber: [colors.amberLight, colors.amber], red: [colors.dangerLight, colors.danger], blue: [colors.blueLight, colors.blue] }[tone];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t[0], borderRadius: radius.md, padding: 12, marginBottom: 12 }}>
      <Ionicons name={icon} size={20} color={t[1]} style={{ marginRight: 10, marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14.5, lineHeight: 20, color: colors.text }}>{children}</Text>
        {action}
      </View>
    </View>
  );
}

/** No signal / taps waiting to be sent / taps the server refused. */
function SyncBar({ day }) {
  const box = useStore(subscribeOutbox, { pending: 0, sending: false, failed: [] });
  return (
    <>
      {(day?.offline || box.pending > 0) && (
        <Notice icon={box.sending ? 'cloud-upload-outline' : 'cloud-offline-outline'}>
          {day?.offline ? 'No signal. Showing today’s work saved on this phone. ' : ''}
          {box.pending ? `${box.pending} ${box.pending === 1 ? 'tap is' : 'taps are'} saved and will be sent ${box.sending ? 'now…' : 'when the signal is back.'}` : ''}
        </Notice>
      )}
      {box.failed.length > 0 && (
        <Notice icon="alert-circle-outline" tone="red" action={<LinkButton icon="checkmark" title="OK" color={colors.danger} onPress={clearFailed} />}>
          <Text style={{ fontWeight: '800' }}>Not saved by the server{'\n'}</Text>
          {box.failed.map((f) => `${f.label}: ${f.message}`).join('\n')}
        </Notice>
      )}
    </>
  );
}

function DutyRow({ icon, on, title, sub, button, onPress, busy, live }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
      <View>
        <IconCircle name={icon} size={42} color={on ? colors.onPrimary : colors.muted} bg={on ? colors.primary : colors.surface2} />
        {live ? <View style={{ position: 'absolute', right: -1, top: -1, width: 13, height: 13, borderRadius: 7, backgroundColor: colors.done, borderWidth: 2, borderColor: '#fff' }} /> : null}
      </View>
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{title}</Text>
        <Text style={[type.small, { marginTop: 1 }]}>{sub}</Text>
      </View>
      <Pressable onPress={onPress} disabled={busy} accessibilityRole="button"
        style={({ pressed }) => ({ minWidth: 86, alignItems: 'center', borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 16,
          backgroundColor: on ? colors.surface : colors.primary, borderWidth: on ? 1.5 : 0, borderColor: colors.borderStrong, opacity: pressed || busy ? 0.7 : 1 })}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: on ? colors.text : colors.onPrimary }}>{busy ? '…' : button}</Text>
      </Pressable>
    </View>
  );
}

/** Shift and location sharing (two separate switches, as the barangay asked). */
function DutyCard({ day, busy, onShift, onGpsLocked }) {
  const share = useLocationShare();
  const onShiftNow = Boolean(day?.shift);
  const sharing = share.sharing;
  const gpsSub = sharing
    ? `${share.lastSentAt ? `Last sent ${clock(share.lastSentAt)}` : 'Getting the first reading…'}${share.mode === 'background' ? ' · works when locked' : ''}`
    : onShiftNow ? 'Turn on while driving the route' : 'Available once your shift starts';
  return (
    <Card style={{ paddingVertical: 4 }}>
      <DutyRow icon={onShiftNow ? 'time' : 'time-outline'} on={onShiftNow} busy={busy}
        title={onShiftNow ? 'On shift' : 'Shift not started'}
        sub={onShiftNow ? `Since ${clock(day.shift.started_at)}${day.shift.pending ? ' · saved, sending…' : ''}` : 'Start when you begin work'}
        button={onShiftNow ? 'End' : 'Start'} onPress={() => onShift(onShiftNow ? 'end' : 'start')} />
      <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 54 }} />
      <DutyRow icon={sharing ? 'navigate' : 'navigate-outline'} on={sharing} busy={share.busy} live={sharing && !share.error}
        title={sharing ? 'Sharing the truck’s location' : 'Location sharing off'} sub={gpsSub}
        button={sharing ? 'Stop' : 'Start'} onPress={sharing ? share.stop : onShiftNow ? () => share.start(day) : onGpsLocked} />
      {sharing && share.error ? <Notice icon="warning-outline">{share.error}</Notice> : null}
      {share.warning ? <Notice icon="information-circle-outline" tone="blue">{share.warning}</Notice> : null}
      {sharing && share.stopAt ? <Text style={[type.small, { marginBottom: 10, color: colors.faint }]}>Sharing stops by itself at {clock(share.stopAt)}.</Text> : null}
    </Card>
  );
}

function Tile({ n, of, label, color }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.line, ...shadow.card }}>
      <Text style={{ fontSize: 24, fontWeight: '800', color }}>{n}<Text style={{ fontSize: 15, color: colors.faint }}>{of !== undefined ? ` / ${of}` : ''}</Text></Text>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.muted, marginTop: 1 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Today at a glance: done / not collected / emergencies. */
function Summary({ stops, emergencies }) {
  const done = stops.filter((s) => s.state === 'done').length;
  const missed = stops.filter((s) => s.state === 'missed').length;
  const ems = emergencies.filter((e) => e.status === 'Scheduled' || e.status === 'In progress').length;
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
      <Tile n={done} of={stops.length} label="Stops done" color={colors.done} />
      <Tile n={missed} label="Not collected" color={missed ? colors.danger : colors.text} />
      <Tile n={ems} label="Emergency" color={ems ? colors.danger : colors.text} />
    </View>
  );
}

/** Arrival and standby countdown for one stop. */
function Standby({ stop, arrival, now, onStart }) {
  if (!arrival) {
    return <LinkButton icon="hourglass-outline" title={stop.standby ? `I’m here · start ${stop.standby}-min timer` : 'I’m here · start standby'} onPress={onStart} />;
  }
  const left = standbyLeft(arrival, now);
  const over = left !== null && left <= 0;
  const total = (arrival.standby || 0) * 60;
  return (
    <View style={{ backgroundColor: over ? colors.amberLight : colors.blueLight, borderRadius: radius.md, padding: 12, marginTop: 12 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name={over ? 'alarm-outline' : 'hourglass-outline'} size={22} color={over ? colors.amber : colors.blue} />
        <Text style={{ flex: 1, marginLeft: 8, fontSize: 15, fontWeight: '800', color: over ? colors.amber : colors.blue }}>
          {left === null ? `Arrived ${clock(arrival.at)}` : over ? 'Standby time is over' : 'Standing by'}
        </Text>
        {left !== null && !over ? <Text style={{ fontSize: 22, fontWeight: '800', color: colors.blue, fontVariant: ['tabular-nums'] }}>{mmss(left)}</Text> : null}
      </View>
      {left !== null && !over ? (
        <View style={{ height: 6, backgroundColor: 'rgba(37,99,168,0.18)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
          <View style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%`, height: 6, backgroundColor: colors.blue }} />
        </View>
      ) : null}
      <Text style={[type.small, { marginTop: 6 }]}>
        {arrival.auto ? `Arrived ${clock(arrival.at)} (GPS).` : `Started ${clock(arrival.at)}.`}{over ? ' Tap Done, or Not collected if residents did not come.' : ''}
      </Text>
    </View>
  );
}

const RAIL = { done: colors.done, missed: colors.danger, now: colors.blue, late: colors.danger, upcoming: colors.borderStrong };

function StopCard({ stop, index, last, next, busy, locked, arrival, now, onDone, onMissed, onUndo, onStandby }) {
  const done = stop.state === 'done';
  const missed = stop.state === 'missed';
  const finished = done || missed;
  const rail = RAIL[stop.state] ?? colors.borderStrong;
  return (
    <View style={{ flexDirection: 'row' }}>
      {/* timeline rail */}
      <View style={{ width: 30, alignItems: 'center' }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, marginTop: 14, alignItems: 'center', justifyContent: 'center',
          backgroundColor: finished ? rail : next ? colors.primary : colors.surface, borderWidth: finished || next ? 0 : 2, borderColor: rail }}>
          {done ? <Ionicons name="checkmark" size={16} color="#fff" />
            : missed ? <Ionicons name="close" size={16} color="#fff" />
              : <Text style={{ fontSize: 13, fontWeight: '800', color: next ? '#fff' : colors.muted }}>{index + 1}</Text>}
        </View>
        {!last ? <View style={{ flex: 1, width: 2, backgroundColor: colors.line, marginTop: 4 }} /> : null}
      </View>

      <Card style={[{ flex: 1, marginLeft: 8 }, next ? { borderColor: colors.primary, borderWidth: 2 } : null, finished ? { backgroundColor: colors.surface2, shadowOpacity: 0, elevation: 0 } : null]}>
        {next ? <Text style={[type.overline, { color: colors.primary, marginBottom: 4 }]}>Next stop</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontSize: next ? 20 : 17, fontWeight: '800', color: finished ? colors.muted : colors.text }}>{stop.name}</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: finished ? colors.faint : colors.muted, marginTop: 2 }}>{fmtRange(stop.start, stop.end)}</Text>
          </View>
          <StateTag state={stop.state} />
        </View>

        {finished ? (
          <>
            <Text style={[type.small, { marginTop: 6, color: missed ? colors.danger : colors.muted }]}>
              {done ? `Done at ${clock(stop.done_at)}${stop.load ? ` · ${loadText(stop.load)}` : ''}`
                : `${stop.missed_reason}${stop.note ? `: ${stop.note}` : ''} · reported ${clock(stop.missed_at)}`}
            </Text>
            <ZoneChips zones={stop.zones} dim />
            {stop.pending ? <PendingTag /> : null}
            {!locked ? <LinkButton icon="arrow-undo-outline" title="Undo" color={colors.muted} onPress={() => onUndo(stop)} /> : null}
          </>
        ) : (
          <>
            {stop.landmark ? <Text style={[type.small, { marginTop: 4 }]} numberOfLines={2}>{stop.landmark}</Text> : null}
            <ZoneChips zones={stop.zones} />
            <Text style={[type.small, { marginTop: 2 }]}>{stop.standby ? `Stand by ${stop.standby} min while residents bring their garbage.` : 'Stand by while residents bring their garbage.'}</Text>
            {stop.pending ? <PendingTag /> : null}
            {!locked && (next || arrival || stop.state !== 'upcoming') ? <Standby stop={stop} arrival={arrival} now={now} onStart={() => onStandby(stop)} /> : null}
            <LinkButton icon="navigate-outline" title="Directions" onPress={() => openInMaps(stop)} />
            {locked ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <Ionicons name="lock-closed" size={15} color={colors.faint} />
                <Text style={[type.small, { marginLeft: 6, color: colors.faint }]}>Start your shift to mark this stop.</Text>
              </View>
            ) : next ? (
              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                <Button title="Done" icon="checkmark-circle-outline" loading={busy} onPress={() => onDone(stop)} style={{ flex: 1, marginRight: 8, minHeight: 54 }} />
                <Button title="Not collected" variant="dangerGhost" disabled={busy} onPress={() => onMissed(stop)} style={{ flex: 1, minHeight: 54 }} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', marginTop: 2 }}>
                <SmallButton title="Done" icon="checkmark" onPress={() => onDone(stop)} busy={busy} />
                <SmallButton title="Not collected" icon="close" danger onPress={() => onMissed(stop)} busy={busy} />
              </View>
            )}
          </>
        )}
      </Card>
    </View>
  );
}

function SmallButton({ title, icon, danger, onPress, busy }) {
  const fg = danger ? colors.danger : colors.primaryDark;
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, paddingVertical: 9, paddingHorizontal: 14, marginRight: 8,
        backgroundColor: danger ? colors.dangerLight : colors.primaryLight, opacity: pressed || busy ? 0.7 : 1 })}>
      <Ionicons name={icon} size={17} color={fg} />
      <Text style={{ color: fg, fontWeight: '800', fontSize: 14, marginLeft: 5 }}>{title}</Text>
    </Pressable>
  );
}

function PendingTag() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
      <Ionicons name="cloud-offline-outline" size={15} color={colors.amber} />
      <Text style={{ color: colors.amber, fontWeight: '700', fontSize: 13, marginLeft: 5 }}>Saved on the phone, waiting to send</Text>
    </View>
  );
}

function EmergencyCard({ em, busy, locked, onStatus }) {
  const done = em.status === 'Completed';
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: done ? colors.doneLight : colors.dangerLight, paddingHorizontal: 16, paddingVertical: 9 }}>
        <Ionicons name={done ? 'checkmark-circle' : 'alert-circle'} size={18} color={done ? colors.done : colors.danger} />
        <Text style={{ flex: 1, marginLeft: 6, color: done ? colors.done : colors.danger, fontWeight: '800', fontSize: 13, letterSpacing: 0.5 }}>EMERGENCY PICKUP</Text>
        <Text style={{ fontWeight: '800', fontSize: 13, color: done ? colors.done : em.overdue ? colors.danger : colors.amber }}>
          {em.status === 'In progress' ? 'On the way' : em.status}{em.overdue && !done && em.status !== 'Cancelled' ? ' · overdue' : ''}{em.pending ? ' · saved' : ''}
        </Text>
      </View>
      <View style={{ padding: 16, paddingTop: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{em.location}</Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.muted, marginTop: 2 }}>{em.end ? fmtRange(em.start, em.end) : `From ${fmtTime(em.start)}`}</Text>
        <Text style={[type.small, { marginTop: 4 }]}>{em.zone || 'No zone'} · {em.reason}</Text>
        {em.notes ? <Text style={[type.small, { marginTop: 4 }]}>{em.notes}</Text> : null}
        {em.lat != null ? <LinkButton icon="navigate-outline" title="Directions" onPress={() => openInMaps(em)} /> : <View style={{ height: 10 }} />}
        {locked ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="lock-closed" size={15} color={colors.faint} />
            <Text style={[type.small, { marginLeft: 6, color: colors.faint }]}>Start your shift to update this pickup.</Text>
          </View>
        ) : !done ? (
          <Button title={em.status === 'In progress' ? 'Mark completed' : 'On the way'} icon={em.status === 'In progress' ? 'checkmark-circle-outline' : 'car-outline'}
            loading={busy} onPress={() => onStatus(em, em.status === 'In progress' ? 'Completed' : 'In progress')} style={{ minHeight: 50 }} />
        ) : null}
      </View>
    </Card>
  );
}

export default function TodayScreen({ navigation }) {
  const { data: day, error, loading, refreshing, reload, pull, setData } = useApi(getDay, { pollMs: 60000 });
  const share = useLocationShare();
  const arrivals = useStore(subscribeArrivals, { date: null, list: {} });
  const [busyKey, setBusyKey] = useState(null);
  const { inbox, refreshInbox } = useCollectorServices();
  useFocusEffect(useCallback(() => { refreshInbox(); }, [refreshInbox]));
  const [loadFor, setLoadFor] = useState(null);
  const [missFor, setMissFor] = useState(null);
  const myArrivals = arrivals.date === day?.date ? arrivals.list : {};
  const timing = (day?.stops ?? []).some((s) => myArrivals[s.id] && s.state !== 'done' && s.state !== 'missed');
  const now = useNow(1000, timing);

  useEffect(() => { if (day && !day.offline) scheduleFirstStopReminder(day); }, [day]);

  /** Runs an action; shows the result (from the server, or saved on the phone). */
  const run = async (key, fn) => {
    setBusyKey(key);
    try {
      const r = await fn();
      if (r?.day) setData(r.queued ? { ...r.day, offline: day?.offline } : r.day);
      else await reload();
    } catch (e) {
      Alert.alert('Couldn’t save', e.message);
    } finally {
      setBusyKey(null);
    }
  };
  const notYet = (stop, go) => {
    if (stop.state !== 'upcoming') return go();
    return Alert.alert('It is not time yet', `${stop.name} starts at ${fmtTime(stop.start)}. Continue anyway?`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: go }]);
  };
  const onDone = (stop) => notYet(stop, () => setLoadFor(stop));
  const onMissed = (stop) => notYet(stop, () => setMissFor(stop));
  const saveDone = (level) => {
    const stop = loadFor; setLoadFor(null);
    run(`s${stop.id}`, () => stopAction(stop, 'done', { load: level }));
    endStandby(stop.id);
  };
  const saveMissed = (reason, note) => {
    const stop = missFor; setMissFor(null);
    run(`s${stop.id}`, () => stopAction(stop, 'missed', { reason, note }));
    endStandby(stop.id);
  };
  const onUndo = (stop) => Alert.alert('Undo this stop?', `${stop.name} will show as not done.${stop.state === 'missed' ? ' The report to the Barangay Admin is withdrawn if they have not seen it yet.' : ''}`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Undo', onPress: () => { run(`s${stop.id}`, () => stopAction(stop, 'undo')); endStandby(stop.id, { forget: true }); } }]);
  const onStandby = (stop) => startStandby(stop, day.date);
  const onStatus = (em, status) => run(`e${em.id}`, () => setEmergencyStatus(em, status));
  const onOther = (o) => run(`o${o.schedule_id}`, () => markOther(o.schedule_id, !o.done_at, day.date));
  const onShift = (action) => {
    if (action === 'end') {
      return Alert.alert('End your shift?', `Your working hours are recorded for the barangay.${share.sharing ? ' Location sharing stops too.' : ''}`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End shift', style: 'destructive', onPress: () => { if (share.sharing) share.stop(); run('shift', () => shiftAction('end')); } },
      ]);
    }
    run('shift', () => shiftAction('start')).then(() => {
      if (share.sharing) return;
      Alert.alert('Shift started', 'Start sharing the truck’s location too?', [
        { text: 'Not now', style: 'cancel' }, { text: 'Start sharing', onPress: () => share.start(day) },
      ]);
    });
    return undefined;
  };

  const onGpsLocked = () => Alert.alert('Start your shift first', 'The truck’s location is shared only during a shift.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Start shift', onPress: () => onShift('start') },
  ]);
  const locked = Boolean(day) && !day.shift;

  const stops = day?.stops ?? [];
  // Only pickups that still need doing; completed and cancelled ones live in the Emergency tab.
  const emergencies = (day?.emergencies ?? []).filter((e) => e.status === 'Scheduled' || e.status === 'In progress');
  const next = stops.find((s) => s.state !== 'done' && s.state !== 'missed');
  const nothing = day && !stops.length && !(day.other ?? []).length && !emergencies.length;
  const allDone = stops.length > 0 && !next;

  return (
    <Screen refreshing={refreshing} onRefresh={pull}>
      <Header sub={day ? fmtDay(day.date, day.day) : ' '} title={day?.me?.first_name ? `Hi, ${day.me.first_name}` : 'Today'}
        right={<View style={{ flexDirection: 'row', alignItems: 'center' }}><GpsPill /><View style={{ width: 8 }} /><Bell count={inbox} onPress={() => navigation.navigate('Notifications')} /></View>} />
      <SyncBar day={day} />
      {day ? <DutyCard day={day} busy={busyKey === 'shift'} onShift={onShift} onGpsLocked={onGpsLocked} /> : null}
      {locked && (stops.length > 0 || emergencies.length > 0) ? (
        <ShiftLock text="You’re not on shift. Start your shift to mark stops, update emergency pickups, share the truck’s location and report problems." />
      ) : null}
      <StateView loading={loading} error={error} onRetry={reload} />

      {day && (stops.length > 0 || emergencies.length > 0) ? <Summary stops={stops} emergencies={emergencies} /> : null}
      {day ? (
        <Pressable onPress={() => navigation.navigate('More', { screen: 'ReportProblem', initial: false })} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
            paddingVertical: 11, paddingHorizontal: 12, marginTop: 4, marginBottom: 4, opacity: pressed ? 0.8 : 1 })}>
          <IconCircle name="warning-outline" size={32} color={colors.danger} bg={colors.dangerLight} />
          <Text style={{ flex: 1, marginLeft: 10, fontSize: 15, fontWeight: '700', color: colors.text }}>Report a problem</Text>
          <Text style={[type.small, { marginRight: 4 }]}>Blocked road, breakdown…</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
        </Pressable>
      ) : null}

      {emergencies.length > 0 && (
        <>
          <SectionTitle>Emergency pickups</SectionTitle>
          {emergencies.map((em) => <EmergencyCard key={em.id} em={em} busy={busyKey === `e${em.id}`} locked={locked} onStatus={onStatus} />)}
          <LinkButton icon="list-outline" title="All emergency pickups" onPress={() => navigation.navigate('Emergency', { screen: 'EmergencyList' })} />
        </>
      )}

      {stops.length > 0 && (
        <>
          <SectionTitle right={allDone ? 'All finished' : undefined}>Truck stops today</SectionTitle>
          {stops.map((s, i) => (
            <StopCard key={s.id} stop={s} index={i} last={i === stops.length - 1} next={next && s.id === next.id} busy={busyKey === `s${s.id}`} locked={locked}
              arrival={myArrivals[s.id]} now={now} onDone={onDone} onMissed={onMissed} onUndo={onUndo} onStandby={onStandby} />
          ))}
        </>
      )}

      {(day?.other ?? []).length > 0 && (
        <>
          <SectionTitle>Other pickups</SectionTitle>
          {day.other.map((o) => (
            <Card key={o.schedule_id}>
              <Text style={type.heading}>{o.zone}</Text>
              <Text style={[type.small, { marginTop: 2 }]}>{o.category} · {fmtRange(o.start, o.end)}</Text>
              <Button title={o.done_at ? 'Undo' : 'Mark as collected'} variant={o.done_at ? 'ghost' : 'primary'} loading={busyKey === `o${o.schedule_id}`} disabled={locked}
                onPress={() => onOther(o)} style={{ marginTop: 12 }} />
            </Card>
          ))}
        </>
      )}

      {nothing && (
        <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
          <IconCircle name="cafe-outline" size={56} color={colors.muted} bg={colors.surface2} />
          <Text style={[type.heading, { marginTop: 12 }]}>No collection for you today</Text>
          <Text style={[type.small, { textAlign: 'center', marginTop: 4 }]}>
            {day.day === 'Sunday' ? 'There is no collection on Sunday.' : 'If you drive the truck today, ask your Barangay Admin to set you as the truck crew.'} Pull down to check again.
          </Text>
        </Card>
      )}

      <LoadSheet stop={loadFor} visible={Boolean(loadFor)} onClose={() => setLoadFor(null)} onPick={saveDone} />
      <MissedSheet stop={missFor} reasons={day?.missed_reasons ?? ['Blocked road', 'Truck breakdown', 'Truck full', 'Residents not ready', 'Other']}
        visible={Boolean(missFor)} onClose={() => setMissFor(null)} onSend={saveMissed} />
    </Screen>
  );
}

