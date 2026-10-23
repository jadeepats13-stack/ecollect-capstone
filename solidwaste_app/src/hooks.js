import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Phone-app data hook. Runs `fetcher` (an async function from src/data) whenever the
 * screen gains focus. The spinner shows only on the first load; later refreshes are
 * silent. `pollMs` enables live polling.
 */
export function useApi(fetcher, { pollMs } = {}) {
  const fetchRef = useRef(fetcher);
  useEffect(() => { fetchRef.current = fetcher; });

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasData = useRef(false);

  const load = useCallback(async (pull = false) => {
    if (pull === true) setRefreshing(true);
    else if (!hasData.current) setLoading(true);
    try {
      const result = await fetchRef.current();
      setData(result);
      setError(null);
      hasData.current = true;
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      if (!pollMs) return undefined;
      const id = setInterval(() => load(), pollMs);
      return () => clearInterval(id);
    }, [load, pollMs])
  );

  return { data, error, loading, refreshing, reload: () => load(), pull: () => load(true), setData };
}

/** Current time, updated every `ms` while `active` (for countdowns). */
export function useNow(ms = 1000, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return now;
}
