import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PortalSectionLoader } from '../components/Layout/PortalSectionLoader';

interface PageLoadEntry {
  loading: boolean;
  message?: string;
  detail?: string;
}

interface PageLoadContextValue {
  setPageLoadEntry: (id: symbol, entry: PageLoadEntry | null) => void;
}

const PageLoadContext = createContext<PageLoadContextValue | null>(null);

export const usePageLoadState = (loading: boolean, message?: string, detail?: string) => {
  const context = useContext(PageLoadContext);
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) {
    idRef.current = Symbol('page-load-entry');
  }

  useLayoutEffect(() => {
    if (!context) return undefined;
    context.setPageLoadEntry(idRef.current!, { loading, message, detail });
    return () => context.setPageLoadEntry(idRef.current!, null);
  }, [context, detail, loading, message]);
};

export const PageLoadGate: React.FC<{
  children: React.ReactNode;
  routeKey: string;
}> = ({ children, routeKey }) => {
  const [entries, setEntries] = useState<Map<symbol, PageLoadEntry>>(() => new Map());
  const [initialising, setInitialising] = useState(true);

  useEffect(() => {
    setInitialising(true);
    setEntries(new Map());
    const timer = window.setTimeout(() => setInitialising(false), 180);
    return () => window.clearTimeout(timer);
  }, [routeKey]);

  const setPageLoadEntry = useCallback((id: symbol, entry: PageLoadEntry | null) => {
    setEntries(current => {
      const next = new Map(current);
      if (!entry) {
        next.delete(id);
      } else {
        next.set(id, entry);
      }
      return next;
    });
  }, []);

  const loadingEntries = useMemo(
    () => Array.from(entries.values()).filter(entry => entry.loading),
    [entries]
  );
  const primaryEntry = loadingEntries[loadingEntries.length - 1];
  const isLoading = initialising || loadingEntries.length > 0;
  const contextValue = useMemo(() => ({ setPageLoadEntry }), [setPageLoadEntry]);

  return (
    <PageLoadContext.Provider value={contextValue}>
      <div className="relative min-h-[22rem]">
        <div className={isLoading ? 'pointer-events-none opacity-0' : 'opacity-100 transition-opacity duration-150'}>
          {children}
        </div>
        {isLoading && (
          <div className="absolute inset-0 z-30 bg-gray-50/95 dark:bg-[#0f1117]/95">
            <PortalSectionLoader
              message={primaryEntry?.message || 'Loading this page'}
              detail={primaryEntry?.detail || 'Preparing the latest club information before opening the page...'}
            />
          </div>
        )}
      </div>
    </PageLoadContext.Provider>
  );
};
