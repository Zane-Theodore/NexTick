import { useEffect, useState } from 'react';

import { API_HEALTH_URL } from '../../services/api';

export type ApiStatus = 'checking' | 'online' | 'offline';

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export function useApiHealthStatus(): ApiStatus {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    let isMounted = true;
    let activeController: AbortController | null = null;

    const checkApiHealth = async () => {
      if (isMounted) {
        setApiStatus('checking');
      }

      if (!API_HEALTH_URL) {
        if (isMounted) {
          setApiStatus('offline');
        }
        return;
      }

      const controller = new AbortController();
      activeController = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      try {
        const response = await fetch(API_HEALTH_URL, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (isMounted) {
          setApiStatus(response.ok ? 'online' : 'offline');
        }
      } catch {
        if (isMounted) {
          setApiStatus('offline');
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (activeController === controller) {
          activeController = null;
        }
      }
    };

    void checkApiHealth();
    const intervalId = window.setInterval(() => {
      void checkApiHealth();
    }, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      isMounted = false;
      activeController?.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  return apiStatus;
}
