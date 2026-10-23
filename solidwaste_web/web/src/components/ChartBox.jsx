// A Chart.js chart that updates in place and shows an empty state when there is no data.
import { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { chartDefaults } from '../lib/ui';

Chart.register(...registerables);

export default function ChartBox({ config, empty = false, emptyText = '', short = false, tall = false, label }) {
  const canvas = useRef(null);
  const chart = useRef(null);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const onTheme = () => setThemeTick((n) => n + 1);
    document.addEventListener('ecollect:theme', onTheme);
    return () => document.removeEventListener('ecollect:theme', onTheme);
  }, []);

  // Rebuild on theme change (colours come from CSS variables).
  useEffect(() => () => { chart.current?.destroy(); chart.current = null; }, [themeTick]);

  useEffect(() => {
    if (!canvas.current || !config) return;
    chartDefaults(Chart);
    if (chart.current) {
      chart.current.data = config.data;
      chart.current.options = config.options || {};
      chart.current.update('none');
    } else {
      chart.current = new Chart(canvas.current, typeof config === 'function' ? config() : config);
    }
  }, [config, themeTick]);

  useEffect(() => () => { chart.current?.destroy(); chart.current = null; }, []);

  return (
    <div className={`chart-box${short ? ' short' : ''}${tall ? ' tall' : ''}`} style={{ position: 'relative' }}>
      <canvas ref={canvas} aria-label={label} style={{ visibility: empty ? 'hidden' : 'visible' }} />
      {empty && (
        <div className="empty" style={{ position: 'absolute', inset: 0, alignContent: 'center' }}>
          <strong>No data for this period</strong><span>{emptyText}</span>
        </div>
      )}
    </div>
  );
}

/** Re-render when the light/dark theme changes (chart colours come from CSS variables). */
export function useThemeTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    document.addEventListener('ecollect:theme', on);
    return () => document.removeEventListener('ecollect:theme', on);
  }, []);
  return tick;
}
