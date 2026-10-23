// A photo shown full width; tapping it opens it full screen.
import React, { useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

export default function PhotoViewer({ uri, label = 'Photo', style }) {
  const [open, setOpen] = useState(false);
  if (!uri) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={`${label}. Tap to enlarge`}>
        <Image source={{ uri }} style={[{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.surface2 }, style]} resizeMode="cover" />
        <View style={{ position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Ionicons name="expand-outline" size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Enlarge</Text>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }} accessibilityLabel="Close photo">
          <Image source={{ uri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" accessibilityLabel={label} />
          <View style={{ position: 'absolute', top: 48, right: 20, flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="close" size={26} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '800', marginLeft: 4 }}>Close</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
