import React, { useEffect, useState } from 'react';
import { TestTube2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface StripeStatus {
  isTestMode?: boolean;
}

export const StripeTestModeBanner: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [isTestMode, setIsTestMode] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.functions.invoke<StripeStatus>('stripe-public-status', { body: {} })
      .then(({ data }) => {
        if (active) setIsTestMode(data?.isTestMode === true);
      })
      .catch(() => {
        if (active) setIsTestMode(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!isTestMode) return null;

  return (
    <div className={`rounded-xl border border-amber-300 bg-amber-50 text-amber-950 shadow-sm ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}>
      <div className="flex items-start gap-2">
        <TestTube2 className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
        <div>
          <p className="font-bold">Stripe Test Mode</p>
          <p className="mt-0.5">Payments created here use Stripe test credentials. No real card money will move.</p>
        </div>
      </div>
    </div>
  );
};
