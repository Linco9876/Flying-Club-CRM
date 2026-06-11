import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Gift, Loader2, Mail, Plane, ShieldCheck, Ticket } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { TrialFlightVoucherAircraftMode } from '../../types';
import toast from 'react-hot-toast';

interface PublicVoucherProduct {
  id: string;
  name: string;
  description: string;
  aircraftMode: TrialFlightVoucherAircraftMode;
  durationMinutes: number;
  bookingBlockMinutes: number;
  price: number;
  checkoutAvailable?: boolean;
  bookingAvailable?: boolean;
  bookingSetupMessage?: string;
  bookingInstructions?: string;
}

interface CheckoutStatus {
  status: string;
  paymentStatus: string;
  productName: string;
  emailTo?: string;
  sendToRecipient?: boolean;
  recipientDeliveryAt?: string | null;
  deliveredAt?: string | null;
}

const aircraftLabel = (mode: TrialFlightVoucherAircraftMode) =>
  mode === 'tecnam' ? 'Any Tecnam' : mode === 'archer' ? 'PA-28 Archer' : 'Selected aircraft';

const formatPrice = (price: number) =>
  price > 0
    ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(price)
    : 'Contact for price';

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const toDateTimeLocalValue = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

export const TrialVoucherSalesPage: React.FC = () => {
  const [products, setProducts] = useState<PublicVoucherProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus | null>(null);
  const [checkoutStatusLoading, setCheckoutStatusLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<PublicVoucherProduct | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    purchaserName: '',
    purchaserEmail: '',
    purchaserPhone: '',
    recipientName: '',
    recipientEmail: '',
    sendToRecipient: false,
    recipientDeliveryAt: '',
  });
  const minimumDeliveryAt = useMemo(() => toDateTimeLocalValue(new Date(Date.now() + 5 * 60_000)), []);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (!sessionId) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const loadCheckoutStatus = async (attempt = 0) => {
      if (cancelled) return;
      if (attempt === 0) setCheckoutStatusLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
          body: { action: 'checkout-status', sessionId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        const nextStatus = data?.checkout || null;
        if (cancelled) return;
        setCheckoutStatus(nextStatus);
        if (nextStatus?.paymentStatus !== 'paid' && attempt < 8) {
          retryTimer = setTimeout(() => void loadCheckoutStatus(attempt + 1), 2500);
        }
      } catch (error) {
        console.error('Failed to load voucher checkout status:', error);
        if (!cancelled) setCheckoutStatus(null);
      } finally {
        if (!cancelled && attempt === 0) setCheckoutStatusLoading(false);
      }
    };

    void loadCheckoutStatus();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  const checkoutMessage = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      if (checkoutStatusLoading) return 'Checking your voucher email status...';
      if (checkoutStatus?.paymentStatus === 'paid') {
        if (checkoutStatus.deliveredAt) {
          return `Payment received. Your ${checkoutStatus.productName} email has been sent to ${checkoutStatus.emailTo || 'the nominated email address'}.`;
        }
        if (checkoutStatus.sendToRecipient && checkoutStatus.recipientDeliveryAt) {
          return `Payment received. Your ${checkoutStatus.productName} email is scheduled for ${new Date(checkoutStatus.recipientDeliveryAt).toLocaleString()}.`;
        }
        return `Payment received. Your ${checkoutStatus.productName} email is queued for delivery to ${checkoutStatus.emailTo || 'the nominated email address'}.`;
      }
      if (checkoutStatus?.paymentStatus === 'pending') {
        return `Stripe has returned from checkout and we are waiting for payment confirmation for ${checkoutStatus.productName}. This usually updates within a few seconds.`;
      }
      return 'Checkout returned successfully. If payment was completed, your voucher email will be confirmed shortly.';
    }
    if (params.get('checkout') === 'cancelled') {
      return 'Checkout was cancelled. You can start again or contact the club for help.';
    }
    return '';
  }, [checkoutStatus, checkoutStatusLoading]);

  const buildMailtoHref = (product?: PublicVoucherProduct) => {
    const subject = encodeURIComponent('Trial flight gift voucher purchase');
    const voucherLines = product
      ? [
          `Preferred voucher: ${product.name}`,
          `Flight time: ${product.durationMinutes} minutes`,
          `Booking block: ${product.bookingBlockMinutes} minutes`,
          `Aircraft: ${aircraftLabel(product.aircraftMode)}`,
          `Advertised price: ${formatPrice(product.price)}`,
        ]
      : [
          'Preferred voucher:',
        ];
    const body = encodeURIComponent(
      [
        'Hi Bendigo Flying Club,',
        '',
        'I would like to purchase a trial instructional flight gift voucher.',
        '',
        ...voucherLines,
        'Recipient name:',
        'Recipient email:',
        'Purchaser name:',
        'Purchaser email:',
        'Phone:',
        '',
        'Please let me know the next steps.',
        '',
        'Thank you.',
      ].join('\n')
    );
    return `mailto:info@bendigoflyingclub.com.au?subject=${subject}&body=${body}`;
  };
  const mailtoHref = useMemo(() => buildMailtoHref(), []);

  const resetPurchaseForm = (product?: PublicVoucherProduct | null) => {
    setSelectedProduct(product || null);
    setPurchaseForm({
      purchaserName: '',
      purchaserEmail: '',
      purchaserPhone: '',
      recipientName: '',
      recipientEmail: '',
      sendToRecipient: false,
      recipientDeliveryAt: '',
    });
  };

  const startCheckout = async () => {
    if (!selectedProduct) return;
    if (!purchaseForm.purchaserName.trim() || !purchaseForm.purchaserEmail.trim()) {
      toast.error('Purchaser name and email are required');
      return;
    }
    if (!isValidEmail(purchaseForm.purchaserEmail)) {
      toast.error('Enter a valid purchaser email address');
      return;
    }
    if (purchaseForm.sendToRecipient && !purchaseForm.recipientEmail.trim()) {
      toast.error('Recipient email is required when sending direct to recipient');
      return;
    }
    if (purchaseForm.sendToRecipient && !isValidEmail(purchaseForm.recipientEmail)) {
      toast.error('Enter a valid recipient email address');
      return;
    }
    if (purchaseForm.sendToRecipient && purchaseForm.recipientDeliveryAt) {
      const deliveryAt = new Date(purchaseForm.recipientDeliveryAt);
      if (!Number.isFinite(deliveryAt.getTime())) {
        toast.error('Choose a valid recipient send date/time');
        return;
      }
      if (deliveryAt.getTime() < Date.now()) {
        toast.error('Recipient send date/time must be in the future');
        return;
      }
    }

    setCheckoutLoading(true);
    try {
      const origin = window.location.origin;
      const { data, error } = await supabase.functions.invoke('create-trial-voucher-checkout', {
        body: {
          productId: selectedProduct.id,
          ...purchaseForm,
          recipientDeliveryAt: purchaseForm.recipientDeliveryAt
            ? new Date(purchaseForm.recipientDeliveryAt).toISOString()
            : undefined,
          successUrl: `${origin}/trial-flight-gift-vouchers?checkout=success`,
          cancelUrl: `${origin}/trial-flight-gift-vouchers?checkout=cancelled`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.checkoutUrl) throw new Error('Stripe checkout did not return a payment link');
      window.location.href = data.checkoutUrl;
    } catch (error) {
      console.error('Failed to start voucher checkout:', error);
      toast.error(error instanceof Error ? error.message : 'Could not start online checkout');
    } finally {
      setCheckoutLoading(false);
    }
  };

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
            {checkoutMessage && (
              <div className="mt-6 rounded-2xl border border-white/15 bg-white/10 p-4 text-sm leading-6 text-blue-50">
                {checkoutMessage}
              </div>
            )}
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
                    <div className="mt-4 flex flex-wrap gap-3">
                      {product.checkoutAvailable ? (
                        <button
                          type="button"
                          onClick={() => resetPurchaseForm(product)}
                          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
                        >
                          Buy online
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      ) : !product.bookingAvailable ? (
                        <span className="inline-flex items-center rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                          Temporarily unavailable online
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                          Available by manual purchase
                        </span>
                      )}
                      <a
                        href={buildMailtoHref(product)}
                        className="inline-flex items-center gap-2 px-1 py-2 text-sm font-bold text-blue-700 hover:text-blue-900"
                      >
                        Contact to purchase
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </div>
                    {!product.bookingAvailable && (
                      <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                        {product.bookingSetupMessage || 'This voucher needs eligible aircraft and instructor availability configured before it can be sold online.'}
                      </div>
                    )}
                    {product.bookingAvailable && !product.checkoutAvailable && (
                      <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                        This voucher can be issued by the club now, but online card payment is not enabled yet. Use “Contact to purchase” and the club can email the voucher to you or schedule it for the recipient.
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-600">
                Voucher products have not been published yet. Contact Bendigo Flying Club and we can arrange a trial instructional flight voucher manually.
              </div>
            )}

            <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              Online card checkout appears automatically for voucher products that have a Stripe Price ID configured. Otherwise, contact the club and we can issue the voucher manually.
            </div>
          </section>
        </main>
      </div>
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Secure checkout</p>
                <h3 className="mt-1 text-2xl font-bold">{selectedProduct.name}</h3>
                <p className="mt-1 text-sm text-slate-600">{formatPrice(selectedProduct.price)}</p>
              </div>
              <button
                type="button"
                onClick={() => resetPurchaseForm(null)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-500 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3">
              <input value={purchaseForm.purchaserName} onChange={e => setPurchaseForm(f => ({ ...f, purchaserName: e.target.value }))} placeholder="Purchaser full name" className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="email" value={purchaseForm.purchaserEmail} onChange={e => setPurchaseForm(f => ({ ...f, purchaserEmail: e.target.value }))} placeholder="Purchaser email" className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
              <input value={purchaseForm.purchaserPhone} onChange={e => setPurchaseForm(f => ({ ...f, purchaserPhone: e.target.value }))} placeholder="Purchaser phone" className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
              <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={purchaseForm.sendToRecipient} onChange={e => setPurchaseForm(f => ({ ...f, sendToRecipient: e.target.checked }))} />
                Send voucher direct to recipient
              </label>
              {purchaseForm.sendToRecipient && (
                <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                  <input value={purchaseForm.recipientName} onChange={e => setPurchaseForm(f => ({ ...f, recipientName: e.target.value }))} placeholder="Recipient name" className="rounded-xl border border-blue-200 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
                  <input type="email" value={purchaseForm.recipientEmail} onChange={e => setPurchaseForm(f => ({ ...f, recipientEmail: e.target.value }))} placeholder="Recipient email" className="rounded-xl border border-blue-200 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
                  <label className="text-sm font-semibold text-blue-900">
                    Send date/time
                    <input type="datetime-local" min={minimumDeliveryAt} value={purchaseForm.recipientDeliveryAt} onChange={e => setPurchaseForm(f => ({ ...f, recipientDeliveryAt: e.target.value }))} className="mt-1 w-full rounded-xl border border-blue-200 bg-white px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <p className="text-xs leading-5 text-blue-800">Leave blank to send the recipient email after payment is confirmed.</p>
                </div>
              )}
              <button
                type="button"
                onClick={startCheckout}
                disabled={checkoutLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                Continue to card payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrialVoucherSalesPage;
