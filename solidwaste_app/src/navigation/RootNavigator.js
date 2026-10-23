import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../AuthContext';
import { configured } from '../lib/supabase';
import { Button, Screen, ScreenTitle } from '../components/ui';
import { colors } from '../theme';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import HomeScreen from '../resident/HomeScreen';
import TruckMapScreen from '../resident/TruckMapScreen';
import ReportListScreen from '../resident/ReportListScreen';
import ReportNewScreen from '../resident/ReportNewScreen';
import ReportDetailScreen from '../resident/ReportDetailScreen';
import NewsScreen from '../resident/NewsScreen';
import NewsDetailScreen from '../resident/NewsDetailScreen';
import ResidentInboxScreen from '../resident/InboxScreen';
import ResidentMoreScreen from '../resident/MoreScreen';
import ResidentProfileScreen from '../resident/ProfileScreen';
import ResidentAccountScreen from '../resident/AccountScreen';
import GuideScreen from '../resident/GuideScreen';
import ZoneHistoryScreen from '../resident/ZoneHistoryScreen';
import { ResidentServicesProvider, useResidentServices } from '../resident/ResidentServices';
import { LocationShareProvider } from '../collector/LocationShare';
import TodayScreen from '../collector/TodayScreen';
import CollectorScheduleScreen from '../collector/CollectorScheduleScreen';
import CollectorRouteScreen from '../collector/CollectorRouteScreen';
import CollectorAccountScreen from '../collector/CollectorAccountScreen';
import ReportProblemScreen from '../collector/ReportProblemScreen';
import MoreScreen from '../collector/MoreScreen';
import EmergencyScreen from '../collector/EmergencyScreen';
import EmergencyDetailScreen from '../collector/EmergencyDetailScreen';
import HistoryScreen from '../collector/HistoryScreen';
import CollectorAnnouncementsScreen from '../collector/CollectorAnnouncementsScreen';
import AnnouncementDetailScreen from '../collector/AnnouncementDetailScreen';
import CollectorInboxScreen from '../collector/InboxScreen';
import { CollectorServicesProvider, useCollectorServices } from '../collector/CollectorServices';
import { navigationRef } from './navRef';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const ICONS = {
  // resident
  Home: ['home', 'home-outline'],
  Truck: ['location', 'location-outline'],
  Report: ['chatbox-ellipses', 'chatbox-ellipses-outline'],
  News: ['megaphone', 'megaphone-outline'],
  // collector
  Today: ['today', 'today-outline'],
  Week: ['calendar', 'calendar-outline'],
  Map: ['map', 'map-outline'],
  ReportProblem: ['warning', 'warning-outline'],
  Emergency: ['alert-circle', 'alert-circle-outline'],
  More: ['menu', 'menu-outline'],
};

const tabOptions = ({ route }) => ({
  headerShown: false,
  tabBarActiveTintColor: colors.primaryDark,
  tabBarInactiveTintColor: colors.faint,
  tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
  tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
  tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 11, fontWeight: '800' },
  tabBarIcon: ({ color, focused }) => (
    <View style={{ width: 50, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.primaryLight : 'transparent' }}>
      <Ionicons name={ICONS[route.name][focused ? 0 : 1]} size={21} color={color} />
    </View>
  ),
});

const subHeader = { headerTintColor: colors.primary, headerTitleStyle: { color: colors.text, fontWeight: '700' }, headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerBackTitle: 'More' };
const ResidentStack = createNativeStackNavigator();
function ResidentReport() {
  return (
    <ResidentStack.Navigator screenOptions={{ ...subHeader, headerBackTitle: 'Report' }}>
      <ResidentStack.Screen name="ReportList" component={ReportListScreen} options={{ headerShown: false }} />
      <ResidentStack.Screen name="ReportNew" component={ReportNewScreen} options={{ title: 'New report' }} />
      <ResidentStack.Screen name="ReportDetail" component={ReportDetailScreen} options={{ title: 'My report' }} />
    </ResidentStack.Navigator>
  );
}
function ResidentHome() {
  return (
    <ResidentStack.Navigator screenOptions={{ ...subHeader, headerBackTitle: 'Home' }}>
      <ResidentStack.Screen name="HomeMain" component={HomeScreen} options={{ headerShown: false }} />
      <ResidentStack.Screen name="Notifications" component={ResidentInboxScreen} />
    </ResidentStack.Navigator>
  );
}
function ResidentNews() {
  return (
    <ResidentStack.Navigator screenOptions={{ ...subHeader, headerBackTitle: 'News' }}>
      <ResidentStack.Screen name="NewsList" component={NewsScreen} options={{ headerShown: false }} />
      <ResidentStack.Screen name="NewsDetail" component={NewsDetailScreen} options={{ title: 'Announcement' }} />
    </ResidentStack.Navigator>
  );
}
function ResidentMore() {
  return (
    <ResidentStack.Navigator screenOptions={subHeader}>
      <ResidentStack.Screen name="MoreHome" component={ResidentMoreScreen} options={{ headerShown: false }} />
      <ResidentStack.Screen name="Profile" component={ResidentProfileScreen} options={{ title: 'My details and zone' }} />
      <ResidentStack.Screen name="Guide" component={GuideScreen} options={{ title: 'Waste sorting guide' }} />
      <ResidentStack.Screen name="ZoneHistory" component={ZoneHistoryScreen} options={{ title: 'Pickup history' }} />
      <ResidentStack.Screen name="Account" component={ResidentAccountScreen} options={{ title: 'Password and log out' }} />
    </ResidentStack.Navigator>
  );
}

function ResidentTabsInner() {
  const { unread } = useResidentServices();
  return (
    <Tab.Navigator screenOptions={tabOptions}>
      <Tab.Screen name="Home" component={ResidentHome} />
      <Tab.Screen name="Truck" component={TruckMapScreen} />
      <Tab.Screen name="Report" component={ResidentReport} />
      <Tab.Screen name="News" component={ResidentNews} options={{ tabBarBadge: unread || undefined }} />
      <Tab.Screen name="More" component={ResidentMore} />
    </Tab.Navigator>
  );
}

function ResidentTabs() {
  return (
    <ResidentServicesProvider>
      <ResidentTabsInner />
    </ResidentServicesProvider>
  );
}

const MoreStack = createNativeStackNavigator();
function CollectorMore() {
  return (
    <MoreStack.Navigator screenOptions={subHeader}>
      <MoreStack.Screen name="MoreHome" component={MoreScreen} options={{ headerShown: false }} />
      <MoreStack.Screen name="Announcements" component={CollectorAnnouncementsScreen} />
      <MoreStack.Screen name="AnnouncementDetail" component={AnnouncementDetailScreen} options={{ title: 'Announcement' }} />
      <MoreStack.Screen name="History" component={HistoryScreen} options={{ title: 'My history' }} />
      <MoreStack.Screen name="Account" component={CollectorAccountScreen} />
      <MoreStack.Screen name="ReportProblem" component={ReportProblemScreen} options={{ title: 'Report a problem' }} />
    </MoreStack.Navigator>
  );
}

const TodayStack = createNativeStackNavigator();
function CollectorToday() {
  return (
    <TodayStack.Navigator screenOptions={{ ...subHeader, headerBackTitle: 'Today' }}>
      <TodayStack.Screen name="TodayMain" component={TodayScreen} options={{ headerShown: false }} />
      <TodayStack.Screen name="Notifications" component={CollectorInboxScreen} />
    </TodayStack.Navigator>
  );
}

const EmergencyStack = createNativeStackNavigator();
function CollectorEmergency() {
  return (
    <EmergencyStack.Navigator screenOptions={{ ...subHeader, headerBackTitle: 'Emergency' }}>
      <EmergencyStack.Screen name="EmergencyList" component={EmergencyScreen} options={{ headerShown: false }} />
      <EmergencyStack.Screen name="EmergencyDetail" component={EmergencyDetailScreen} options={{ title: 'Emergency pickup' }} />
    </EmergencyStack.Navigator>
  );
}

function CollectorTabsInner() {
  const { unread, openEmergencies } = useCollectorServices();
  return (
    <Tab.Navigator screenOptions={tabOptions}>
      <Tab.Screen name="Today" component={CollectorToday} />
      <Tab.Screen name="Week" component={CollectorScheduleScreen} />
      <Tab.Screen name="Emergency" component={CollectorEmergency} options={{ tabBarBadge: openEmergencies || undefined }} />
      <Tab.Screen name="Map" component={CollectorRouteScreen} />
      <Tab.Screen name="More" component={CollectorMore} options={{ tabBarBadge: unread || undefined }} />
    </Tab.Navigator>
  );
}

function CollectorTabs() {
  // The providers sit here so location sharing, saved taps and notifications keep working while
  // the collector switches tabs, and stop when they log out.
  return (
    <LocationShareProvider>
      <CollectorServicesProvider>
        <CollectorTabsInner />
      </CollectorServicesProvider>
    </LocationShareProvider>
  );
}

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.primary, card: colors.surface, text: colors.text, border: colors.border },
};

function Notice({ title, text, children }) {
  return (
    <Screen style={{ paddingTop: 80 }}>
      <ScreenTitle sub={text}>{title}</ScreenTitle>
      {children}
    </Screen>
  );
}

export default function RootNavigator() {
  const { loading, signedIn, role, roles, profileError, signOut } = useAuth();

  if (!configured) {
    return (
      <Notice
        title="Supabase isn’t set up"
        text="Copy .env.example to .env, fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart Expo with: npx expo start -c"
      />
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Signed in, but with no role this app can use (admins use the website).
  if (signedIn && !role) {
    const isAdmin = roles.includes('lgu_admin') || roles.includes('barangay_admin');
    return (
      <Notice
        title={isAdmin ? 'Admins use the website' : 'Account not ready'}
        text={
          isAdmin
            ? 'Your account is an LGU / barangay admin account. Please open the ECollect web portal on a computer.'
            : profileError || 'We could not find a resident or collector profile for this account.'
        }
      >
        <Button title="Log out" variant="ghost" onPress={signOut} />
      </Notice>
    );
  }

  return (
    <NavigationContainer theme={theme} ref={navigationRef}>
      {signedIn && role === 'collector' ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="CollectorTabs" component={CollectorTabs} />
        </Stack.Navigator>
      ) : signedIn ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Tabs" component={ResidentTabs} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
