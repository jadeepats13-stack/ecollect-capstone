// The Barangay Poblacion map used by the collector's Map tab and the resident's Truck tab.
// Google Maps when the app was built with a key (see app.config.js), otherwise the Leaflet street map.
//
// Props: data { zones, stops, emergencies }, trucks [{ id, lat, lng, heading, title, sub, live }],
//        insets { top, bottom } (space covered by the screen's own panels), satellite, myZone,
//        onPickStop(id), showsUserLocation (Google only), onReady.
// Ref:   fitAll(), focusStop(id), focusEmergency(id), focusPoint(lat, lng), focusTruck(id).
import React, { forwardRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import GoogleMap from './GoogleMap';
import LeafletMap from './LeafletMap';

export const HAS_GOOGLE_MAPS = Platform.OS === 'android' && Constants.expoConfig?.extra?.googleMaps === true;

const PobMap = forwardRef(function PobMap(props, ref) {
  return HAS_GOOGLE_MAPS ? <GoogleMap ref={ref} {...props} /> : <LeafletMap ref={ref} {...props} />;
});

export default PobMap;
