// Bell button with the unread count, top right of Home (resident) and Today (collector).
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, shadow } from '../theme';

export default function Bell({ count, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={count ? `Notifications, ${count} unread` : 'Notifications'} hitSlop={6}
      style={({ pressed }) => [{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: colors.line, opacity: pressed ? 0.75 : 1 }, shadow.card]}>
      <Ionicons name={count ? 'notifications' : 'notifications-outline'} size={21} color={colors.text} />
      {count ? (
        <View style={{ position: 'absolute', top: -3, right: -3, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.danger,
          alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg }}>
          <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '900' }}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
