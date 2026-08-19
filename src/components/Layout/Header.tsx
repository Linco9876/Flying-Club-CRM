import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { Calendar, CreditCard, Plane, User, LogOut } from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { PwaInstallButton } from './PwaInstallButton';
import { useOrganisationSettings, usePortalUxSettings } from '../../hooks/useSettings';
import {
  fetchOwnXeroBalance,
  XERO_MEMBER_BALANCE_UPDATED_EVENT,
  XeroMemberBalance,
} from '../../lib/xeroMemberBalance';
import { useFinancialProviders } from '../../context/financialProviderState';

const formatCurrency = (amount: number, decimals: number) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(amount);

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const { settings } = useOrganisationSettings();
  const { settings: portalSettings } = usePortalUxSettings();
  const { capabilities: financialProviders } = useFinancialProviders();
  const [balance, setBalance] = React.useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const businessName = settings?.club_name?.trim() || 'Bendigo Flying Club';
  const avatarUrl = user?.avatar?.trim();
  const balanceLabel = balance == null ? undefined : formatCurrency(balance, portalSettings.currency_decimals);

  React.useEffect(() => {
    let mounted = true;

    const applyBalance = (data: XeroMemberBalance | null) => {
      if (!mounted) return;
      const showLinkedBalance = Boolean(data?.connected && data?.linked);
      const netBalance = Number(data?.netBalance ?? (Number(data?.availableCredit ?? 0) - Number(data?.outstandingInvoiceTotal ?? 0)));
      setBalance(showLinkedBalance && Number.isFinite(netBalance) ? netBalance : null);
    };

    const handleBalanceUpdate = (event: Event) => {
      applyBalance((event as CustomEvent<XeroMemberBalance | null>).detail ?? null);
    };

    const fetchBalance = async () => {
      if (!user?.id || !financialProviders.xero.accountingAvailable) {
        if (mounted) {
          setBalance(null);
        }
        return;
      }

      try {
        const data = await fetchOwnXeroBalance();
        applyBalance(data);
      } catch (error) {
        if (!mounted) return;
        console.error('Failed to load header balance:', error);
        setBalance(null);
      }
    };

    window.addEventListener(XERO_MEMBER_BALANCE_UPDATED_EVENT, handleBalanceUpdate);
    fetchBalance();
    return () => {
      mounted = false;
      window.removeEventListener(XERO_MEMBER_BALANCE_UPDATED_EVENT, handleBalanceUpdate);
    };
  }, [financialProviders.xero.accountingAvailable, user?.id]);

  const topNavItems = [
    { label: 'Profile', path: '/', icon: User, active: location.pathname === '/' || location.pathname === '/profile' },
    { label: 'Calendar', path: '/calendar', icon: Calendar, active: location.pathname.startsWith('/calendar') },
    ...(financialProviders.financeEnabled
      ? [{ label: 'Balance', value: balanceLabel, path: '/billing', icon: CreditCard, active: location.pathname.startsWith('/billing') }]
      : []),
  ];

  return (
    <header className="app-sticky-header sticky top-0 z-40 border-b border-gray-200/80 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
      <div className="app-header-safe-area w-full px-3 sm:px-6 lg:px-8">
        <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1.5 lg:min-h-16 lg:grid-cols-[minmax(18rem,1fr)_auto_minmax(18rem,1fr)] lg:py-0">
          <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 lg:col-start-1 lg:row-start-1">
            {settings?.logo_url ? (
              <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-[#363b45] dark:bg-[#11141a] sm:h-10 sm:w-10 lg:h-11 lg:w-11">
                <img
                  src={settings.logo_url}
                  alt={`${businessName} logo`}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-sm sm:h-10 sm:w-10 lg:h-11 lg:w-11">
                <Plane className="h-5 w-5 text-white lg:h-6 lg:w-6" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="max-w-[10.5rem] truncate text-sm font-bold leading-tight text-gray-950 dark:text-gray-100 min-[390px]:max-w-[13rem] min-[390px]:text-base sm:max-w-none lg:text-xl">{businessName}</h1>
              <p className="hidden text-xs text-gray-500 dark:text-gray-400 lg:block">Members Flight Management System</p>
            </div>
          </div>

          <nav className="no-scrollbar hidden min-w-0 justify-center overflow-x-auto rounded-xl bg-gray-100 p-1 dark:bg-[#11141a] lg:col-start-2 lg:row-start-1 lg:flex">
            {topNavItems.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => navigate(item.path)}
                  aria-label={item.label}
                  className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors sm:flex-none sm:gap-2 sm:px-5 sm:text-sm ${
                    item.active
                      ? 'bg-white text-blue-700 shadow-sm dark:bg-[#262b33] dark:text-blue-200'
                      : 'text-gray-600 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden truncate min-[420px]:inline">{item.label}</span>
                  {item.value && (
                    <span className="hidden max-w-24 truncate rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-900 dark:bg-[#11141a] dark:text-gray-100 sm:inline">
                      {item.value}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 sm:gap-3 lg:col-start-3 lg:row-start-1">
            <div className="hidden sm:block">
              <PwaInstallButton />
            </div>
            <NotificationBell />

            <div className="flex min-w-0 items-center gap-2">
              <div className="hidden min-w-0 text-right xl:block">
                <p className="max-w-40 truncate text-sm font-semibold leading-tight text-gray-900 dark:text-gray-100">{user?.name}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-blue-600 shadow-sm ring-2 ring-white dark:ring-[#171a21]"
                aria-label="Open profile"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={`${user?.name || 'User'} avatar`} className="h-full w-full object-cover" />
                ) : (
                  <User className="h-5 w-5 text-white" />
                )}
              </button>
            </div>

            <button
              onClick={logout}
              className="hidden rounded-full border border-transparent p-2 text-gray-400 transition-colors hover:border-gray-200 hover:bg-gray-50 hover:text-gray-700 dark:hover:border-[#363b45] dark:hover:bg-[#11141a] dark:hover:text-gray-100 lg:block"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut className="h-5 w-5 sm:h-4 sm:w-4" />
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};
