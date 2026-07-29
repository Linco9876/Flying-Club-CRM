import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import {
  disabledFinancialProviderCapabilities,
  type FinancialProviderCapabilities,
} from '../types/financialProviders';
import {
  FINANCIAL_PROVIDER_REFRESH_EVENT,
  FinancialProviderContext,
} from './financialProviderState';

export const FinancialProviderProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [capabilities, setCapabilities] = useState<FinancialProviderCapabilities>(
    disabledFinancialProviderCapabilities,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: functionError } =
        await supabase.functions.invoke<FinancialProviderCapabilities>(
          'financial-provider-status',
          { body: {} },
        );
      if (functionError) throw functionError;
      if (!data) throw new Error('Financial provider status was empty.');
      setCapabilities(data);
      setError(null);
    } catch (nextError) {
      console.warn('Unable to load financial provider status:', nextError);
      setCapabilities(disabledFinancialProviderCapabilities);
      setError('Financial provider availability could not be confirmed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleRefresh = () => void refresh();
    window.addEventListener(FINANCIAL_PROVIDER_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(FINANCIAL_PROVIDER_REFRESH_EVENT, handleRefresh);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ capabilities, loading, error, refresh }),
    [capabilities, error, loading, refresh],
  );

  return (
    <FinancialProviderContext.Provider value={value}>
      {children}
    </FinancialProviderContext.Provider>
  );
};
