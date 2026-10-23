// Small building blocks shared by the collector screens.
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, status as STATUS, type } from '../theme';
import { useLocationShare } from './LocationShare';
import { subscribeShift } from './offline';

/** Live / Off pill shown on the collector screens. */
export function GpsPill() {
  const share = useLocationShare();
  const on = share?.sharing;
  const problem = on && share?.error;
  const fg = problem ? colors.amber : on ? colors.done : colors.faint;
  const bg = problem ? colors.amberLight : on ? colors.doneLight : colors.surface;
  return (
    <View accessibilityRole="text" accessibilityLabel={on ? 'Location sharing is on' : 'Location sharing is off'}
      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 6,
        borderWidth: on && !problem ? 0 : 1, borderColor: problem ? '#ecd3a6' : colors.line }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fg, marginRight: 6 }} />
      <Text style={{ color: fg, fontWeight: '800', fontSize: 13 }}>{problem ? 'GPS retrying' : on ? 'GPS live' : 'GPS off'}</Text>
    </View>
  );
}

/** Screen title (small line above it), with the GPS pill or another element on the right. */
export function Header({ title, sub, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        {sub ? <Text style={[type.overline, { marginBottom: 2 }]}>{sub}</Text> : null}
        <Text style={type.title} accessibilityRole="header">{title}</Text>
      </View>
      <View style={{ marginBottom: 4 }}>{right === undefined ? <GpsPill /> : right}</View>
    </View>
  );
}

export function StateTag({ state, label }) {
  const s = STATUS[state] ?? STATUS.upcoming;
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color: s.fg, fontWeight: '800', fontSize: 12.5 }}>{label ?? s.label}</Text>
    </View>
  );
}

export function ZoneChips({ zones, dim }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
      {zones.map((z) => {
        const name = typeof z === 'string' ? z : z.name;
        const done = typeof z === 'object' && z.done;
        return (
          <View key={name} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: done ? colors.doneLight : dim ? colors.surface2 : colors.primaryLight,
            borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginBottom: 6 }}>
            {done ? <Ionicons name="checkmark" size={13} color={colors.done} style={{ marginRight: 3 }} /> : null}
            <Text style={{ fontSize: 13, fontWeight: '700', color: done ? colors.done : dim ? colors.muted : colors.primaryDark }}>{name}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Opens the stop's exact Google Maps link (Street View) or its coordinates. */
export function openInMaps(stop) {
  const url = stop?.maps_url || (stop?.lat != null ? `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}` : null);
  if (url) Linking.openURL(url).catch(() => {});
}

export function LinkButton({ icon, title, onPress, color = colors.primary }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}>
      <Ionicons name={icon} size={19} color={color} />
      <Text style={{ color, fontWeight: '700', fontSize: 15, marginLeft: 6 }}>{title}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14, marginBottom: 10 }}>
      <Text style={[type.overline, { color: colors.muted }]}>{children}</Text>
      {right ? <Text style={[type.small, { fontWeight: '600' }]}>{right}</Text> : null}
    </View>
  );
}

/** Round icon badge used in lists and cards. */
export function IconCircle({ name, color = colors.primary, bg = colors.primaryLight, size = 40 }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={Math.round(size * 0.5)} color={color} />
    </View>
  );
}

/** A white rounded group of rows with thin dividers (settings-style list). */
export function ListGroup({ children, style }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: 14, overflow: 'hidden' }, shadow.card, style]}>
      {items.map((c, i) => (
        <View key={i} style={i ? { borderTopWidth: 1, borderTopColor: colors.line } : null}>{c}</View>
      ))}
    </View>
  );
}

export function ListRow({ icon, iconColor, iconBg, title, sub, right, onPress, danger }) {
  const row = { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14 };
  const inner = (
    <>
      {icon ? <IconCircle name={icon} size={38} color={danger ? colors.danger : iconColor} bg={danger ? colors.dangerLight : iconBg} /> : null}
      <View style={{ flex: 1, marginLeft: icon ? 12 : 0 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: danger ? colors.danger : colors.text }}>{title}</Text>
        {sub ? <Text style={[type.small, { marginTop: 1 }]}>{sub}</Text> : null}
      </View>
      {right}
      {onPress && !danger ? <Ionicons name="chevron-forward" size={20} color={colors.faint} style={{ marginLeft: 6 }} /> : null}
    </>
  );
  if (!onPress) return <View style={row}>{inner}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [row, pressed && { backgroundColor: colors.surface2 }]}>
      {inner}
    </Pressable>
  );
}

/** Small count badge (unread announcements). */
export function Badge({ count }) {
  if (!count) return null;
  return (
    <View style={{ minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{count}</Text>
    </View>
  );
}

/** Icons for the problem / "not collected" reasons (shared by Report and the stop sheet). */
export const REASON_ICONS = {
  'Blocked road': 'trail-sign-outline', 'Truck breakdown': 'construct-outline', 'Truck full': 'cube-outline',
  'Overflowing pile': 'trash-outline', 'Residents not ready': 'people-outline', Other: 'chatbubble-ellipses-outline',
};

/** A two-per-row choice tile with an icon (problem type, reason). */
export function ChoiceTile({ label, selected, onPress, tone = 'primary', icon }) {
  const on = tone === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}
      style={({ pressed }) => ({ width: '48.5%', flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radius.md, marginBottom: 8,
        backgroundColor: selected ? on : colors.surface2, borderWidth: 1.5, borderColor: selected ? on : colors.line, opacity: pressed ? 0.85 : 1 })}>
      <Ionicons name={icon ?? REASON_ICONS[label] ?? 'alert-circle-outline'} size={22} color={selected ? '#fff' : on} />
      <Text style={{ flex: 1, marginLeft: 8, fontSize: 14.5, fontWeight: '700', color: selected ? '#fff' : colors.text }} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

/** true / false once known (from the last day loaded); null while unknown. */
export function useOnShift() {
  const [v, setV] = useState(null);
  useEffect(() => subscribeShift(setV), []);
  return v;
}

/** Shown where an action needs a running shift. onStart: optional button to start it. */
export function ShiftLock({ text = 'Start your shift to use this.', onStart, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.amberLight, borderRadius: radius.md, padding: 12, marginBottom: 12 }, style]}>
      <Ionicons name="lock-closed" size={18} color={colors.amber} />
      <Text style={{ flex: 1, marginLeft: 8, fontSize: 14.5, lineHeight: 20, color: colors.text }}>{text}</Text>
      {onStart ? (
        <Pressable onPress={onStart} accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14, marginLeft: 8, opacity: pressed ? 0.8 : 1 })}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Start shift</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
