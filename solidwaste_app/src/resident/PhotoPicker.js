// Take or choose one photo (reports and report ratings). Shows a preview with Change / Remove.
import React from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius } from '../theme';

async function pick(camera) {
  const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', camera ? 'Allow the camera for ECollect in your phone settings to take a photo.' : 'Allow photos for ECollect in your phone settings to choose a photo.');
    return null;
  }
  const opts = { mediaTypes: ['images'], quality: 0.8, allowsEditing: false };
  const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  return !res.canceled && res.assets?.[0] ? res.assets[0] : null;
}

function Choice({ icon, label, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 16, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed',
        borderColor: colors.borderStrong, backgroundColor: colors.surface2, opacity: pressed ? 0.8 : 1 })}>
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text style={{ fontWeight: '700', color: colors.text, marginTop: 4 }}>{label}</Text>
    </Pressable>
  );
}

export default function PhotoPicker({ photo, onChange }) {
  const choose = async (camera) => {
    try { const p = await pick(camera); if (p) onChange(p); } catch (e) { Alert.alert('Couldn’t open', e.message); }
  };
  if (!photo) {
    return (
      <View style={{ flexDirection: 'row' }}>
        <Choice icon="camera-outline" label="Take photo" onPress={() => choose(true)} />
        <View style={{ width: 10 }} />
        <Choice icon="images-outline" label="From gallery" onPress={() => choose(false)} />
      </View>
    );
  }
  return (
    <View>
      <Image source={{ uri: photo.uri }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.surface2 }} resizeMode="cover" accessibilityLabel="Selected photo" />
      <View style={{ flexDirection: 'row', marginTop: 8 }}>
        <Pressable onPress={() => Alert.alert('Change photo', undefined, [
          { text: 'Take photo', onPress: () => choose(true) }, { text: 'From gallery', onPress: () => choose(false) }, { text: 'Cancel', style: 'cancel' }])}
          accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, marginRight: 20 }}>
          <Ionicons name="swap-horizontal" size={18} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '800', marginLeft: 5 }}>Change</Text>
        </Pressable>
        <Pressable onPress={() => onChange(null)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: '800', marginLeft: 5 }}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}
