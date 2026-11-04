import { useCallback, useEffect, useRef, useState } from "react";

// Keeps the last good data through a failed refresh, so the screen never blanks out.
export function usePolling(load, intervalMs, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const loadRef = useRef(load);
  const latestRequest = useRef(0);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const data = await loadRef.current();
      if (requestId === latestRequest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (requestId === latestRequest.current) {
        setState((current) => ({ ...current, error, loading: false }));
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [load, refresh]);

  useEffect(() => {
    if (!enabled || !intervalMs) return undefined;
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  return { ...state, refresh };
}
