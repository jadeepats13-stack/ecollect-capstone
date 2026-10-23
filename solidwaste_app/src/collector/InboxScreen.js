// Collector app: notification inbox (opened from the bell on Today).
import React from 'react';
import NotificationsScreen from '../shared/NotificationsScreen';
import { openCollectorNotification, useCollectorServices } from './CollectorServices';

export default function InboxScreen() {
  const { refreshInbox } = useCollectorServices();
  return <NotificationsScreen onOpen={openCollectorNotification} onRead={refreshInbox} />;
}
