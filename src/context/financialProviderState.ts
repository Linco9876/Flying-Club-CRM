import { createContext, useContext } from 'react';
import {
  disabledFinancialProviderCapabilities,
  type FinancialProviderCapabilities,
} from '../types/financialProviders';

export const FINANCIAL_PROVIDER_REFRESH_EVENT =
  'bfc-financial-provider-refresh';

export interface FinancialProviderContextValue {
  capabilities: FinancialProviderCapabilities;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const FinancialProviderContext =
  createContext<FinancialProviderContextValue>({
    capabilities: disabledFinancialProviderCapabilities,
    loading: true,
    error: null,
    refresh: async () => undefined,
  });

export const requestFinancialProviderRefresh = () => {
  window.dispatchEvent(new Event(FINANCIAL_PROVIDER_REFRESH_EVENT));
};

export const useFinancialProviders = () =>
  useContext(FinancialProviderContext);
