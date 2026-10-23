// Bottom sheets for a truck stop: "How full is the truck?" and "Not collected".
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, ErrorBanner, Field } from '../components/ui';
import { ChoiceTile } from './parts';
import { colors, radius, type } from '../theme';

export function BottomSheet({ visible, onClose, title, sub, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,35,29,0.45)' }} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
          paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 20 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={type.heading}>{title}</Text>
              {sub ? <Text style={[type.small, { marginTop: 2 }]}>{sub}</Text> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={colors.muted} />
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const LOADS = [
  { level: 1, label: '¼', text: 'A quarter' },
  { level: 2, label: '½', text: 'Half' },
  { level: 3, label: '¾', text: 'Three quarters' },
  { level: 4, label: 'Full', text: 'Full' },
];
export const loadText = (level) => ({ 1: 'Truck about ¼ full', 2: 'Truck about ½ full', 3: 'Truck about ¾ full', 4: 'Truck full' }[level] ?? '');

/** Truck outline that fills up to the chosen level (a picture is quicker to read than words). */
function TruckLevel({ level, selected }) {
  const fill = selected ? colors.onPrimary : colors.primary;
  return (
    <View style={{ width: 34, height: 24, borderRadius: 4, borderWidth: 2, borderColor: fill, overflow: 'hidden', marginBottom: 6 }}>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${level * 25}%`, backgroundColor: fill, opacity: 0.85 }} />
    </View>
  );
}

/** "Done at this stop" → how full is the truck now? (an estimate, optional) */
export function LoadSheet({ stop, visible, onClose, onPick }) {
  const [level, setLevel] = useState(null);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Done at ${stop?.name ?? ''}`} sub="How full is the truck now? Your best guess is fine.">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
        {LOADS.map((l) => {
          const on = level === l.level;
          return (
            <Pressable key={l.level} onPress={() => setLevel(l.level)} accessibilityRole="radio" accessibilityState={{ selected: on }}
              accessibilityLabel={`${l.text} full`}
              style={{ flex: 1, marginHorizontal: 4, alignItems: 'center', paddingVertical: 14, borderRadius: radius.md,
                borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
              <TruckLevel level={l.level} selected={on} />
              <Text style={{ fontSize: 18, fontWeight: '800', color: on ? colors.onPrimary : colors.text }}>{l.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Button title={level ? 'Save: done at this stop' : 'Choose how full, or skip'} icon={level ? 'checkmark-circle-outline' : undefined} disabled={!level} onPress={() => { onPick(level); setLevel(null); }} style={{ minHeight: 54 }} />
      <Pressable onPress={() => { onPick(null); setLevel(null); }} accessibilityRole="button" style={{ paddingVertical: 14, alignItems: 'center' }}>
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 16 }}>Skip, just mark done</Text>
      </Pressable>
    </BottomSheet>
  );
}

/** "Not collected" → why (sent to the Barangay Admin as a field report too). */
export function MissedSheet({ stop, reasons, visible, onClose, onSend }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const close = () => { setErr(''); onClose(); };
  const send = () => {
    if (!reason) return setErr('Choose why.');
    if (reason === 'Other' && !note.trim()) return setErr('Write a short note on why.');
    onSend(reason, note.trim());
    setReason(null); setNote(''); setErr('');
  };
  return (
    <BottomSheet visible={visible} onClose={close} title={`Not collected at ${stop?.name ?? ''}`} sub="Why couldn’t you collect here? Your Barangay Admin sees this right away.">
      <Text style={[type.label, { marginBottom: 8 }]}>Why?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 6 }}>
        {(reasons ?? []).map((r) => <ChoiceTile key={r} label={r} tone="danger" selected={reason === r} onPress={() => setReason(r)} />)}
      </View>
      <Field label={reason === 'Other' ? 'Note (needed)' : 'Note (optional)'} value={note} onChangeText={setNote} maxLength={500}
        placeholder="For example: road works, truck cannot pass" multiline style={{ minHeight: 70 }} />
      <ErrorBanner message={err} />
      <Button title="Send to the Barangay Admin" icon="paper-plane-outline" variant="danger" onPress={send} style={{ minHeight: 54 }} />
    </BottomSheet>
  );
}
