import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Gift, Loader2, Mail, Plane, ShieldCheck, Ticket } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { TrialFlightVoucherAircraftMode } from '../../types';

interface PublicVoucherProduct {
  id: string;
  name: string;
  description: string;
  aircraftMode: TrialFlightVoucherAircraftMode;
  durationMinutes: number;
  bookingBlockMinutes: number;
  price: number;
  bookingInstructions?: string;
}

const aircraftLabel = (mode: TrialFlightVoucherAircraftMode) =>
  mode === 'tecnam' ? 'Any Tecnam' : mode === 'archer' ? 'PA-28 Archer' : 'Selected aircraft';

const formatPrice = (price: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(price || 0);

export const TrialVoucherSalesPage: React.FC = () => {
  const [products, setProducts] = useState<PublicVoucherProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProducts = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
          body: { action: 'products' },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setProducts(data?.products || []);
      } catch (error) {
        console.error('Failed to load trial flight voucher products:', error);
        setProducts([]);
      } finally {
        setLoading(false);
      }
    };

    void loadProducts();
  }, []);

  const mailtoHref = useMemo(() => {
    const subject = encodeURIComponent('Trial flight gift voucher purchase');
    const body = encodeURIComponent(
      'Hi Bendigo Flying Club,\n\nI would like to purchase a trial instructional flight gift voucher.\n\nPreferred voucher:\nRecipient name:\nPurchaser name:\nPhone:\n\nThank you.'
    );
    return `mailto:info@bendigoflyingclub.com.au?subject=${subject}&body=${body}`;
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500">
              <Plane className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-200">Bendigo Flying Club</p>
              <h1 className="text-2xl font-bold">Trial Flight Gift Vouchers</h1>
            </div>
          </a>
          <a
            href="/trial-flight-voucher"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-blue-50 transition hover:bg-white/10"
          >
            <Ticket className="h-4 w-4" />
            Redeem a voucher
          </a>
        </header>

        <main className="grid flex-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-3xl bg-gradient-to-br from-blue-900 to-slate-900 p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
            <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
              <Gift className="h-7 w-7 text-blue-100" />
            </div>
            <h2 className="text-3xl font-bold leading-tight">Give someone their first flight lesson.</h2>
            <p className="mt-4 leading-7 text-blue-100">
              Trial instructional flight vouchers can be emailed to the purchaser to forward later, or sent direct to the recipient at a scheduled date and time.
            </p>
            <div className="mt-6 grid gap-3 text-sm text-blue-50">
              <div className="flex gap-3 rounded-2xl bg-white/10 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-200" />
                <p>Each booking reserves the flight time plus 30 minutes for arrival, briefing and paperwork.</p>
              </div>
              <div className="flex gap-3 rounded-2xl bg-white/10 p-4">
                <Plane className="mt-0.5 h-5 w-5 shrink-0 text-blue-200" />
                <p>Available times are checked against the voucher aircraft type and qualified instructor availability.</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Voucher options</p>
                <h3 className="mt-1 text-2xl font-bold">Choose a trial flight</h3>
              </div>
              <a
                href={mailtoHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <Mail className="h-4 w-4" />
                Contact to purchase
              </a>
            </div>

            {loading ? (
              <div className="flex min-h-48 items-center justify-center rounded-2xl bg-slate-50 text-slate-600">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading voucher options...
              </div>
            ) : products.length > 0 ? (
              <div className="space-y-3">
                {products.map(product => (
                  <article key={product.id} className="rounded-2xl border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/40">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h4 className="text-lg font-bold text-slate-950">{product.name}</h4>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{product.description}</p>
                      </div>
                      <p className="shrink-0 text-xl font-black text-blue-700">{formatPrice(product.price)}</p>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Flight</p>
                        <p className="font-bold">{product.durationMinutes} min</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Booking block</p>
                        <p className="font-bold">{product.bookingBlockMinutes} min</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Aircraft</p>
                        <p className="font-bold">{aircraftLabel(product.aircraftMode)}</p>
                      </div>
                    </div>
                    <a
                      href={mailtoHref}
                      className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900"
                    >
                      Request this voucher
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-600">
                Voucher products have not been published yet. Contact Bendigo Flying Club and we can arrange a trial instructional flight voucher manually.
              </div>
            )}

            <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              Online card checkout will be connected here later with Stripe. For now, this page displays the live voucher products and directs purchasers to Bendigo Flying Club to complete payment and issue the voucher.
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default TrialVoucherSalesPage;
