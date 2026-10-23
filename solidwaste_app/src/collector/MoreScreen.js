// Collector app: the "More" tab — who I am, announcements, my history, account, notifications.
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { getCollector } from '../data/collector';
import { useApi } from '../hooks';
import { Screen } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { Badge, Header, IconCircle, ListGroup, ListRow, SectionTitle } from './parts';
import { useCollectorServices } from './CollectorServices';

const logo = require('../../assets/images/logo-mark.png');

function Profile({ me }) {
  const name = `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim() || 'Garbage collector';
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[{ backgroundColor: colors.primary, borderRadius: radius.xl, padding: 18, marginBottom: 18 }, shadow.card]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 21, fontWeight: '800' }}>{initials}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }} numberOfLines={1}>{name}</Text>
          <Text style={{ color: '#cfe3d7', fontSize: 14, marginTop: 1 }} numberOfLines={1}>{me?.email ?? 'Garbage collector'}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 14 }}>
        {[['Truck', me?.truck?.plate_number || 'Not assigned'], ['Home zone', me?.route?.zone_name || 'Not set']].map(([k, v]) => (
          <View key={k} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 12, marginRight: k === 'Truck' ? 8 : 0 }}>
            <Text style={{ color: '#cfe3d7', fontSize: 12, fontWeight: '700' }}>{k.toUpperCase()}</Text>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 1 }} numberOfLines={1}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function MoreScreen({ navigation }) {
  const { unread, pushNote, retryPush } = useCollectorServices();
  const { data: me } = useApi(getCollector);
  const on = !pushNote;
  return (
    <Screen>
      <Header title="More" />
      <Profile me={me} />

      <ListGroup>
        <ListRow icon="warning-outline" iconColor={colors.danger} iconBg={colors.dangerLight} title="Report a problem" sub="Blocked road, breakdown, full truck…" onPress={() => navigation.navigate('ReportProblem')} />
        <ListRow icon="megaphone-outline" title="Announcements" sub="From your barangay" right={<Badge count={unread} />} onPress={() => navigation.navigate('Announcements')} />
        <ListRow icon="time-outline" iconColor={colors.blue} iconBg={colors.blueLight} title="My history" sub="Stops, emergencies and shifts · 14 days" onPress={() => navigation.navigate('History')} />
        <ListRow icon="key-outline" iconColor={colors.amber} iconBg={colors.amberLight} title="Account and password" sub="Change password, log out" onPress={() => navigation.navigate('Account')} />
      </ListGroup>

      <SectionTitle>Notifications</SectionTitle>
      <View style={[{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line }, shadow.card]}>
        <IconCircle name={on ? 'notifications' : 'notifications-off-outline'} size={38} color={on ? colors.done : colors.amber} bg={on ? colors.doneLight : colors.amberLight} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{on ? 'On' : 'Not available'}</Text>
          <Text style={[type.small, { marginTop: 2 }]}>
            {on ? 'You’re told about new or changed emergency pickups, stop time changes and announcements.' : pushNote}
          </Text>
          {!on ? (
            <Pressable onPress={retryPush} hitSlop={8} accessibilityRole="button">
              <Text style={{ color: colors.primary, fontWeight: '800', marginTop: 8 }}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ alignItems: 'center', marginTop: 28 }}>
        <Image source={logo} style={{ width: 40, height: 40, borderRadius: 10 }} accessibilityIgnoresInvertColors />
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 6 }}>ECollect</Text>
        <Text style={[type.small, { color: colors.faint }]}>Barangay Poblacion, Iligan City · v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
      </View>
    </Screen>
  );
}
