/**
 * The garbage truck as seen from above, front pointing up (north). Rotated to the direction of travel
 * when it is known. Same drawing as the collector app's map (src/collector/mapHtml.js).
 *   state: 'live' | 'recent' | 'stale'   heading: degrees from north, or null
 */
export const TRUCK_TOP_SVG =
  '<svg viewBox="0 0 28 40" aria-hidden="true">' +
  '<rect x="2.5" y="8" width="3" height="6" rx="1" fill="#1f2937"/><rect x="22.5" y="8" width="3" height="6" rx="1" fill="#1f2937"/>' +
  '<rect x="2.5" y="27" width="3" height="7" rx="1" fill="#1f2937"/><rect x="22.5" y="27" width="3" height="7" rx="1" fill="#1f2937"/>' +
  '<rect x="5" y="15" width="18" height="23" rx="2.5" fill="currentColor" stroke="#fff" stroke-width="1.5"/>' +
  '<path d="M9.5 19v15M14 19v15M18.5 19v15" stroke="#fff" stroke-opacity=".4" stroke-width="1.4"/>' +
  '<rect x="6" y="2" width="16" height="13" rx="4.5" fill="currentColor" stroke="#fff" stroke-width="1.5"/>' +
  '<rect x="8.5" y="4.5" width="11" height="4" rx="1.5" fill="#fff" fill-opacity=".9"/>' +
  '</svg>';

export function truckMarkerHtml(state, heading) {
  const turn = Number.isFinite(heading) ? `transform:rotate(${Math.round(heading)}deg)` : '';
  return `<div class="truck-icon ${state || 'stale'}"><div class="truck-body" style="${turn}">${TRUCK_TOP_SVG}</div></div>`;
}
