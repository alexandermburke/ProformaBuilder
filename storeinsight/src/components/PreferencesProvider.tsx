'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

type PreferencesContextValue = {
  delinquencyAudit: boolean;
  setDelinquencyAudit: (value: boolean) => void;
  toggleDelinquencyAudit: () => void;
  isReady: boolean;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const DELINQ_STORAGE_KEY = 'storeinsight-pref-delinquency-audit';

const getInitialDelinquencyAudit = (): boolean => {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem(DELINQ_STORAGE_KEY);
  return stored === 'true';
};

export function PreferencesProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [delinquencyAudit, setDelinquencyAudit] = useState(false);
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    const initial = getInitialDelinquencyAudit();
    setDelinquencyAudit(initial);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    window.localStorage.setItem(DELINQ_STORAGE_KEY, delinquencyAudit ? 'true' : 'false');
  }, [delinquencyAudit, isReady]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      delinquencyAudit,
      setDelinquencyAudit,
      toggleDelinquencyAudit: () => setDelinquencyAudit((prev) => !prev),
      isReady,
    }),
    [delinquencyAudit, isReady],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return ctx;
}
