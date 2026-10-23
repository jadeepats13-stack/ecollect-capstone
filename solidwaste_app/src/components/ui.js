import React, { useContext } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderHeightContext } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, type } from '../theme';

/**
 * Page wrapper: safe area, optional pull-to-refresh, keyboard friendly.
 * Under a navigation header (back arrow) the header already covers the clock area, so no top inset then.
 */
export function Screen({ children, refreshing, onRefresh, scroll = true, style, footer }) {
  const insets = useSafeAreaInsets();
  const underHeader = (useContext(HeaderHeightContext) ?? 0) > 0;
  const top = underHeader ? 0 : insets.top;
  const pad = { paddingTop: top + 12, paddingHorizontal: 20, paddingBottom: 32 };

  if (!scroll) {
    return <View style={[{ flex: 1, backgroundColor: colors.bg }, pad, style]}>{children}</View>;
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* keeps scrolled content from showing under the clock and notch (screens without a header) */}
      {top > 0 ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: top, backgroundColor: colors.bg, zIndex: 10 }} /> : null}
      <ScrollView
        contentContainerStyle={[pad, style]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {/* stays at the bottom (for example a Send button) */}
      {footer ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line }}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style, onPress }) {
  const Body = onPress ? Pressable : View;
  return (
    <Body onPress={onPress} style={[styles.card, style]}>
      {children}
    </Body>
  );
}

/**
 * variant: 'primary' (filled green) | 'ghost' (green outline) | 'danger' (filled red) | 'dangerGhost' (red outline) | 'soft' (light green)
 * icon: an Ionicons name shown before the title.
 */
export function Button({ title, onPress, loading, variant = 'primary', disabled, style, icon }) {
  const v = VARIANTS[variant] ?? VARIANTS.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: v.bg, borderColor: v.border, borderWidth: v.border ? 1.5 : 0 },
        (disabled || loading) && { opacity: 0.55 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {icon ? <Ionicons name={icon} size={20} color={v.fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[styles.btnText, { color: v.fg }]} numberOfLines={1}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}
const VARIANTS = {
  primary: { bg: colors.primary, fg: colors.onPrimary },
  ghost: { bg: 'transparent', fg: colors.primary, border: colors.primary },
  danger: { bg: colors.danger, fg: '#fff' },
  dangerGhost: { bg: colors.surface, fg: colors.danger, border: '#e7b3a9' },
  soft: { bg: colors.primaryLight, fg: colors.primaryDark },
};

export function Field({ label, error, style, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={[type.label, { marginBottom: 6 }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor="#9aa59a"
        style={[styles.input, props.multiline && { minHeight: 96, textAlignVertical: 'top' }, style]}
        {...props}
      />
      {error ? <Text style={[type.small, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox}>
      <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}>{message}</Text>
    </View>
  );
}

/** Loading / error / empty states for list screens. Renders nothing when there is data. */
export function StateView({ loading, error, onRetry, empty, emptyTitle, emptyText }) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[type.heading, { marginBottom: 6, textAlign: 'center' }]}>Couldn’t load this</Text>
        <Text style={[type.small, { textAlign: 'center', marginBottom: 16 }]}>{error}</Text>
        <Button title="Try again" variant="ghost" onPress={onRetry} style={{ paddingHorizontal: 28 }} />
      </View>
    );
  }
  if (empty) {
    return (
      <View style={styles.center}>
        <Text style={[type.heading, { marginBottom: 6, textAlign: 'center' }]}>{emptyTitle}</Text>
        <Text style={[type.small, { textAlign: 'center' }]}>{emptyText}</Text>
      </View>
    );
  }
  return null;
}

export function ScreenTitle({ children, sub }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={type.title}>{children}</Text>
      {sub ? <Text style={[type.small, { marginTop: 4 }]}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 12,
    ...shadow.card,
  },
  btn: { borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  btnText: { fontSize: 16, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  errorBox: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  center: { paddingVertical: 60, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
});

/** Search field with a clear button (used on lists). */
export function SearchBox({ value, onChangeText, placeholder, label, style }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, marginBottom: 12 }, style]}>
      <Ionicons name="search" size={18} color={colors.faint} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#9aa59a" returnKeyType="search"
        accessibilityLabel={label ?? placeholder} style={{ flex: 1, paddingVertical: 11, paddingHorizontal: 8, fontSize: 16, color: colors.text }} />
      {value ? <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={colors.faint} /></Pressable> : null}
    </View>
  );
}

/** A row of filter chips with optional counts: options [[key, label, count?]]. */
export function FilterChips({ options, value, onChange, style }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[{ marginHorizontal: -20, marginBottom: 12, flexGrow: 0 }, style]} contentContainerStyle={{ paddingHorizontal: 20 }}>
      {options.map(([k, label, n]) => {
        const on = value === k;
        return (
          <Pressable key={k} onPress={() => onChange(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, marginRight: 8,
              backgroundColor: on ? colors.primary : colors.surface, borderWidth: 1.5, borderColor: on ? colors.primary : colors.line }}>
            <Text style={{ fontWeight: '800', fontSize: 14, color: on ? '#fff' : colors.text }}>{label}</Text>
            {n != null ? (
              <View style={{ marginLeft: 6, minWidth: 20, paddingHorizontal: 6, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? 'rgba(255,255,255,0.25)' : colors.surface2 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#fff' : colors.muted }}>{n}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
