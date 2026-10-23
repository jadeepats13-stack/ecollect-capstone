// Adds the Google Maps key to the app at build time. The key is NOT stored in git:
//  - on your computer put GOOGLE_MAPS_API_KEY=... in .env (already git-ignored);
//  - for EAS builds: npx eas-cli env:set --name GOOGLE_MAPS_API_KEY --value <key> --environment preview --visibility sensitive
//    (eas.json: the "preview" build profile has "environment": "preview", so the build gets it)
// Without a key the app still works and shows the simpler street map (Leaflet) instead of Google Maps.
module.exports = ({ config }) => {
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ['react-native-maps', key ? { androidGoogleMapsApiKey: key } : {}]],
    extra: { ...config.extra, googleMaps: Boolean(key) },
  };
};
