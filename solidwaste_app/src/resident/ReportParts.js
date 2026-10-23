// Resident reports: the "Sent → Seen → Resolved" tracker and status colours.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

export const STAGE = {
  sent: { label: 'Sent', fg: colors.amber, bg: colors.amberLight },
  seen: { label: 'Seen by the barangay', fg: colors.blue, bg: colors.blueLight },
  resolved: { label: 'Resolved', fg: colors.done, bg: colors.doneLight },
  dismissed: { label: 'Closed without action', fg: colors.faint, bg: colors.surface2 },
};

export const TYPE_ICONS = {
  'Missed collection': 'trash-bin-outline', 'Illegal dumping': 'warning-outline', 'Overflowing bin': 'trash-outline',
  'Truck concern': 'bus-outline', Suggestion: 'bulb-outline', Other: 'chatbubble-ellipses-outline',
};

export function StagePill({ stage }) {
  const s = STAGE[stage] ?? STAGE.sent;
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: s.fg, fontSize: 12, fontWeight: '800' }}>{s.label}</Text>
    </View>
  );
}

/** Three dots joined by lines: Sent, Seen, Resolved (the last one reads "Closed" when dismissed). */
export function Tracker({ stage }) {
  const steps = ['Sent', 'Seen', stage === 'dismissed' ? 'Closed' : 'Resolved'];
  const reached = { sent: 0, seen: 1, resolved: 2, dismissed: 2 }[stage] ?? 0;
  const tint = stage === 'dismissed' ? colors.faint : stage === 'resolved' ? colors.done : colors.primary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginVertical: 6 }} accessibilityLabel={`Report status: ${STAGE[stage]?.label ?? 'Sent'}`}>
      {steps.map((label, i) => (
        <React.Fragment key={label}>
          <View style={{ alignItems: 'center', width: 64 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: i <= reached ? tint : colors.surface, borderWidth: i <= reached ? 0 : 2, borderColor: colors.borderStrong }}>
              {i <= reached ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
            </View>
            <Text style={{ fontSize: 12.5, fontWeight: '700', marginTop: 4, color: i <= reached ? colors.text : colors.faint }}>{label}</Text>
          </View>
          {i < steps.length - 1 ? <View style={{ flex: 1, height: 3, borderRadius: 2, marginTop: 11, backgroundColor: i < reached ? tint : colors.line }} /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

/** Thin 3-part bar for list cards: sent, seen, resolved/closed. */
export function StageBar({ stage }) {
  const reached = { sent: 0, seen: 1, resolved: 2, dismissed: 2 }[stage] ?? 0;
  const tint = STAGE[stage]?.fg ?? colors.primary;
  return (
    <View style={{ flexDirection: 'row', marginTop: 10 }} accessibilityLabel={`Status: ${STAGE[stage]?.label ?? 'Sent'}`}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, marginRight: i < 2 ? 4 : 0, backgroundColor: i <= reached ? tint : colors.line }} />
      ))}
    </View>
  );
}

/** Stars: shows `value`; with onChange the stars can be tapped (1-5). */
export function Stars({ value = 0, onChange, size = 30, gap = 6 }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityRole={onChange ? 'adjustable' : 'text'} accessibilityLabel={`${value || 0} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? '#e0a100' : colors.borderStrong} />;
        return onChange ? (
          <Pressable key={n} onPress={() => onChange(n)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? 's' : ''}: ${STAR_LABELS[n]}`} style={{ marginRight: gap }}>{star}</Pressable>
        ) : <View key={n} style={{ marginRight: gap / 2 }}>{star}</View>;
      })}
    </View>
  );
}
export const STAR_LABELS = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Very good'];
