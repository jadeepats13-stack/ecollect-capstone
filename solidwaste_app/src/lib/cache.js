// Keeps the last answer of a server call on the phone, so screens still show something without signal.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOffline } from '../collector/offline';

const PREFIX = 'ecollect-cache:';

/**
 * Runs fn(). Online: saves and returns { data, offline: false }. Without signal: returns the saved
 * copy as { data, offline: true, savedAt } (or throws when nothing was saved yet).
 */
export async function cached(key, fn) {
  try {
    const data = await fn();
    AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data })).catch(() => {});
    return { data, offline: false };
  } catch (e) {
    if (!isOffline(e)) throw e;
    let saved = null;
    try { saved = JSON.parse((await AsyncStorage.getItem(PREFIX + key)) || 'null'); } catch { /* ignore */ }
    if (!saved) throw new Error('No internet connection. Connect and pull down to try again.');
    return { data: saved.data, offline: true, savedAt: saved.at };
  }
}

/** Forget everything saved by cached() (on log out). */
export async function clearCache() {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch { /* ignore */ }
}
