// Live map (both panels).
import { PageHead } from '../components/common';
import ZoneMapPanel from '../components/ZoneMapPanel';
import { usePanel } from '../components/Layout';

export default function LiveMap() {
  const { role } = usePanel();
  return (
    <>
      <PageHead title="Live map" desc={role === 'lgu'
        ? "View only. Zone status for any date, saved routes, open resident reports and the last GPS position sent by each collector's phone."
        : "Zone status for any date, saved routes, open resident reports and the last GPS position sent by each collector's phone. Refreshes every 10 seconds; trucks glide to each new position."} />
      <ZoneMapPanel full showFeedback title="Barangay Poblacion"
        desc={'Select a zone in the list or on the map to see its schedule and status. Truck markers are true live positions only while they show "Live".'} />
      <p className="note" style={{ marginTop: 12 }}>{role === 'barangay'
        ? 'Boundary: traced by Barangay Poblacion on satellite imagery (28 Oct 2026). Zone areas (dashed) were traced from the barangay’s zone map and reach that boundary; they are approximate until confirmed on the ground. Map and imagery © Google (or © Esri when Google Maps is not set up); tap “i” on the map for the credits.'
        : 'Boundary: PSA/NAMRIA administrative boundaries, 2023 (PSGC 1030900017), simplified. Zone areas (dashed) were traced from the barangay’s zone map and are approximate until confirmed on the ground. Map © Google (or © OpenStreetMap contributors when Google Maps is not set up).'}</p>
    </>
  );
}
