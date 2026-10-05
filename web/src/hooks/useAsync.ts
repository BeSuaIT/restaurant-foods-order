import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
}

export interface AsyncOptions {
  /** false = chưa cần gọi API (VD: modal đang đóng) */
  enabled?: boolean;
}

export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  opts: AsyncOptions = {},
): AsyncState<T> {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    let alive = true;
    setLoading(true);
    fetcherRef
      .current(ctrl.signal)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Đã có lỗi xảy ra.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, enabled, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return {
    data,
    loading,
    error,
    reload,
    setData: (updater) =>
      setData((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater)),
  };
}