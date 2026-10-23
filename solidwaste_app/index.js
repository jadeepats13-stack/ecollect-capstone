import { registerRootComponent } from 'expo';

// Defines the background GPS task before anything else, so Android can wake the app for it
// while the phone is locked (collector app).
import './src/collector/gps';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
