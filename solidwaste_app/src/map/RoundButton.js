// Round white button floating over a map (fit, locate, satellite).
import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, shadow } from '../theme';

export default function RoundButton({ icon, label, onPress, disabled, on }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={on != null ? { selected: on } : undefined}
      style={({ pressed }) => [{ width: 46, height: 46, borderRadius: 23, backgroundColor: on ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center',
        marginBottom: 10, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, shadow.raised]}>
      <Ionicons name={icon} size={22} color={on ? '#fff' : colors.text} />
    </Pressable>
  );
}
