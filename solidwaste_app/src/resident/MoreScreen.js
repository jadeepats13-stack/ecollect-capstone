// Resident app, More: me and my zone, waste guide, zone history, reminders, notifications, account.
import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { getHome, getMe } from '../data/resident';
import { useApi } from '../hooks';
import { Screen } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { Header, IconCircle, ListGroup, ListRow, SectionTitle } from '../collector/parts';
import { useResidentServices } from './ResidentServices';
import { remindersOn, setRemindersOn } from './reminders';

const logo = require('../../assets/images/logo-mark.png');

function Profile({ me, onPress }) {
  const name = `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim() || 'Resident';
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Edit my details and zone"
      style={({ pressed }) => [{ backgroundColor: colors.primary, borderRadius: radius.xl, padding: 18, marginBottom: 18, opacity: pressed ? 0.92 : 1 }, shadow.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 21, fontWeight: '800' }}>{initials}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }} numberOfLines={1}>{name}</Text>
          <Text style={{ color: '#cfe3d7', fontSize: 14, marginTop: 1 }} numberOfLines={1}>{me?.email ?? ''}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 12, marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#cfe3d7', fontSize: 12, fontWeight: '700' }}>MY ZONE</Text>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 1 }}>{me?.route?.zone_name || 'Not set'}</Text>
        </View>
        <Text style={{ color: '#fff', fontWeight: '800' }}>Edit ›</Text>
      </View>
    </Pressable>
  );
}

export default function MoreScreen({ navigation }) {
  const { pushNote, retryPush } = useResidentServices();
  const { data: me } = useApi(getMe);
  const [rem, setRem] = useState(null);
  useEffect(() => { remindersOn().then(setRem); }, []);
  const toggleReminders = async (on) => {
    setRem(on);
    const day = on ? await getHome().catch(() => null) : null;
    const ok = await setRemindersOn(on, day);
    if (on && ok === false) { setRem(false); await setRemindersOn(false); Alert.alert('Notifications are off', 'Allow notifications for ECollect in your phone settings to get reminders.'); }
  };
  const pushOn = !pushNote;

  return (
    <Screen>
      <Header title="More" right={null} />
      <Profile me={me} onPress={() => navigation.navigate('Profile')} />

      <ListGroup>
        <ListRow icon="leaf-outline" title="Waste sorting guide" sub="How to sort your garbage" onPress={() => navigation.navigate('Guide')} />
        <ListRow icon="calendar-outline" iconColor={colors.blue} iconBg={colors.blueLight} title="My zone’s pickup history" sub="Up to 60 days, list or calendar" onPress={() => navigation.navigate('ZoneHistory')} />
        <ListRow icon="person-outline" iconColor={colors.primaryDark} title="My details and zone" sub="Name, contact, address, zone" onPress={() => navigation.navigate('Profile')} />
        <ListRow icon="key-outline" iconColor={colors.amber} iconBg={colors.amberLight} title="Password and log out" onPress={() => navigation.navigate('Account')} />
      </ListGroup>

      <SectionTitle>Alerts</SectionTitle>
      <ListGroup>
        <ListRow icon="alarm-outline" title="Pickup reminders" sub="7:00 PM the day before, and 30 minutes before the truck"
          right={<Switch value={!!rem} disabled={rem === null} onValueChange={toggleReminders} trackColor={{ true: colors.primaryMid, false: colors.border }} thumbColor={rem ? colors.primary : '#f4f4f4'} />} />
        <View style={{ flexDirection: 'row', padding: 14 }}>
          <IconCircle name={pushOn ? 'notifications' : 'notifications-off-outline'} size={38} color={pushOn ? colors.done : colors.amber} bg={pushOn ? colors.doneLight : colors.amberLight} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Alerts from the barangay: {pushOn ? 'on' : 'not available'}</Text>
            <Text style={[type.small, { marginTop: 2 }]}>
              {pushOn ? 'Truck near your stop, garbage not collected, replies to your reports, announcements.' : pushNote}
            </Text>
            {!pushOn ? (
              <Pressable onPress={retryPush} hitSlop={8} accessibilityRole="button">
                <Text style={{ color: colors.primary, fontWeight: '800', marginTop: 8 }}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ListGroup>

      <View style={{ alignItems: 'center', marginTop: 20 }}>
        <Image source={logo} style={{ width: 40, height: 40, borderRadius: 10 }} accessibilityIgnoresInvertColors />
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 6 }}>ECollect</Text>
        <Text style={[type.small, { color: colors.faint }]}>Barangay Poblacion, Iligan City · v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
      </View>
    </Screen>
  );
}
