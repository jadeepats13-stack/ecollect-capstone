// Settings that were in config.php in the PHP version.
export const SITE_NAME = 'ECollect';

/** Barangay Poblacion has exactly this many zones (the dashboards warn otherwise). */
export const FIXED_ZONE_COUNT = 10;

/**
 * Performance is counted from this date ('YYYY-MM-DD'). Leave empty to start from the
 * first pickup the collector app logged, so days before go-live are not counted as missed.
 * Can also be set with VITE_PERFORMANCE_TRACKING_START in web/.env.
 */
export const PERFORMANCE_TRACKING_START = import.meta.env.VITE_PERFORMANCE_TRACKING_START || '';

/** Resident report statuses that count as closed. Any other status is unresolved. */
export const FEEDBACK_CLOSED_STATUSES = ['Resolved', 'Closed', 'Dismissed'];

/** How old a collector's last GPS ping can be and still show as Live / Recent (minutes). */
export const GPS_LIVE_MINUTES = 5;
export const GPS_RECENT_MINUTES = 60;

/** Map: OpenStreetMap tiles, with CARTO as a fallback if OSM refuses the request. */
export const MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MAP_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const MAP_FALLBACK_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';
export const MAP_FALLBACK_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
