import React from 'react';
import { Plane } from 'lucide-react';

interface PortalSectionLoaderProps {
  floating?: boolean;
  message?: string;
  detail?: string;
}

export const PortalSectionLoader: React.FC<PortalSectionLoaderProps> = ({
  floating = false,
  message = 'Loading this section',
  detail = 'Preparing the latest club information...',
}) => (
  <div
    className={`portal-section-loader ${floating ? 'pointer-events-none absolute inset-0 z-20 flex items-start justify-center px-4 pt-24 sm:pt-32' : 'flex min-h-[22rem] items-center justify-center p-4 sm:p-8'}`}
    role="status"
    aria-live="polite"
  >
    <div className="portal-section-loader-card relative w-full max-w-md overflow-hidden rounded-2xl border border-white/70 bg-white/90 p-6 text-center shadow-2xl shadow-blue-950/10 backdrop-blur dark:border-white/10 dark:bg-[#111827]/92 dark:shadow-black/30">
      <div className="portal-section-loader-sky" />
      <div className="relative z-10">
        <div className="portal-section-loader-orbit mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-blue-700 shadow-inner dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-200">
          <img src="/favicon.svg" alt="" className="h-11 w-11 drop-shadow" />
          <Plane className="portal-section-loader-plane absolute h-5 w-5" />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-blue-600 dark:text-blue-300">Bendigo Flying Club</p>
        <h2 className="mt-2 text-lg font-semibold text-gray-950 dark:text-gray-50">{message}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{detail}</p>
        <div className="mx-auto mt-5 h-1.5 max-w-[14rem] overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
          <div className="portal-section-loader-progress h-full rounded-full bg-gradient-to-r from-blue-500 via-sky-300 to-amber-300" />
        </div>
      </div>
    </div>
  </div>
);
