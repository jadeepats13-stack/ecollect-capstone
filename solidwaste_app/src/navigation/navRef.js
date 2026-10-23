import { createNavigationContainerRef } from '@react-navigation/native';

/** Lets code outside the screens (for example a tapped notification) open a screen. */
export const navigationRef = createNavigationContainerRef();
