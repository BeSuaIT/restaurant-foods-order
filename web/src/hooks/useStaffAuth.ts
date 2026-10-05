import { useCallback, useEffect, useState } from 'react';
import { api, tokenStore } from '../lib/http';
import type { StaffUser } from '../types';

export function useStaffAuth() {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = tokenStore.getStaffToken();
    if (!token) {
      setReady(true);
      return;
    }
    let alive = true;
    api
      .get<StaffUser>('/auth/me', { staffToken: token })
      .then((u) => alive && setUser(u))
      .catch(() => tokenStore.clearStaffToken())
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(() => {
    tokenStore.clearStaffToken();
    setUser(null);
  }, []);

  return { user, ready, logout };
}