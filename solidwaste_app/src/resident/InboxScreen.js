// Resident app: notification inbox (opened from the bell on Home).
import React from 'react';
import NotificationsScreen from '../shared/NotificationsScreen';
import { openResidentNotification, useResidentServices } from './ResidentServices';

export default function InboxScreen() {
  const { refreshInbox } = useResidentServices();
  return <NotificationsScreen onOpen={openResidentNotification} onRead={refreshInbox} />;
}
