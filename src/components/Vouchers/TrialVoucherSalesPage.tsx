import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Gift, Loader2, Mail, Plane, Ticket } from 'lucide-react';
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
  warning?: string;
}

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
  const [productsError, setProductsError] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus | null>(null);
  const [checkoutStatusLoading, setCheckoutStatusLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<PublicVoucherProduct | null>(null);
  const [purchaseMode, setPurchaseMode] = useState<'checkout' | 'manual'>('checkout');
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
  const missingStandardOptions: Array<{
    mode: TrialFlightVoucherAircraftMode;
    name: string;
    description: string;
  }> = [];

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setProductsError('');
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
      setProductsError(error instanceof Error ? error.message : 'Could not load voucher options');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

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
        if (checkoutStatus.warning) {
          return `Payment received for ${checkoutStatus.productName}, but the voucher email needs attention: ${checkoutStatus.warning}. Please contact Bendigo Flying Club if it does not arrive shortly.`;
        }
        if (checkoutStatus.sendToRecipient && checkoutStatus.recipientDeliveryAt) {
          return `Payment received. Your ${checkoutStatus.productName} email is scheduled for ${new Date(checkoutStatus.recipientDeliveryAt).toLocaleString()}.`;
        }
        return `Payment received. Your ${checkoutStatus.productName} email is queued for delivery to ${checkoutStatus.emailTo || 'the nominated email address'}.`;
      }
      if (checkoutStatus?.paymentStatus === 'pending') {
        return `We are waiting for payment confirmation for ${checkoutStatus.productName}. This usually updates within a few seconds.`;
      }
      return 'Checkout returned successfully. If payment was completed, your voucher email will be confirmed shortly.';
    }
    if (params.get('checkout') === 'cancelled') {
      return 'Checkout was cancelled. You can start again or contact the club for help.';
    }
    return '';
  }, [checkoutStatus, checkoutStatusLoading]);

  const buildMailtoHref = (
    product?: PublicVoucherProduct,
    form?: typeof purchaseForm
  ) => {
    const subject = encodeURIComponent('Trial flight gift voucher purchase');
    const voucherLines = product
      ? [
          `Preferred voucher: ${product.name}`,
          `Flight time: ${product.durationMinutes} minutes`,
          `Advertised price: ${formatPrice(product.price)}`,
        ]
      : [
          'Preferred voucher:',
        ];
    const deliveryLines = form
      ? [
          `Purchaser name: ${form.purchaserName.trim() || ''}`,
          `Purchaser email: ${form.purchaserEmail.trim() || ''}`,
          `Purchaser phone: ${form.purchaserPhone.trim() || ''}`,
          `Send direct to recipient: ${form.sendToRecipient ? 'Yes' : 'No - send to purchaser'}`,
          `Recipient name: ${form.recipientName.trim() || ''}`,
          `Recipient email: ${form.recipientEmail.trim() || ''}`,
          `Preferred recipient send date/time: ${
            form.sendToRecipient && form.recipientDeliveryAt
              ? new Date(form.recipientDeliveryAt).toLocaleString()
              : form.sendToRecipient
                ? 'As soon as payment/manual issue is complete'
                : 'Not applicable'
          }`,
        ]
      : [
          'Recipient name:',
          'Recipient email:',
          'Purchaser name:',
          'Purchaser email:',
          'Phone:',
          'Send direct to recipient: Yes / No',
          'Preferred recipient send date/time:',
        ];
    const body = encodeURIComponent(
      [
        'Hi Bendigo Flying Club,',
        '',
        'I would like to purchase a trial instructional flight gift voucher.',
        '',
        ...voucherLines,
        '',
        ...deliveryLines,
        '',
        'Please let me know the next steps.',
        '',
        'Thank you.',
      ].join('\n')
    );
    return `mailto:info@bendigoflyingclub.com.au?subject=${subject}&body=${body}`;
  };
  const mailtoHref = useMemo(() => buildMailtoHref(), []);

  const resetPurchaseForm = (
    product?: PublicVoucherProduct | null,
    mode: 'checkout' | 'manual' = 'checkout'
  ) => {
    setSelectedProduct(product || null);
    setPurchaseMode(mode);
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

  const validatePurchaseForm = () => {
    if (!purchaseForm.purchaserName.trim() || !purchaseForm.purchaserEmail.trim()) {
      toast.error('Purchaser name and email are required');
      return false;
    }
    if (!isValidEmail(purchaseForm.purchaserEmail)) {
      toast.error('Enter a valid purchaser email address');
      return false;
    }
    if (purchaseForm.sendToRecipient && !purchaseForm.recipientEmail.trim()) {
      toast.error('Recipient email is required when sending direct to recipient');
      return false;
    }
    if (purchaseForm.sendToRecipient && !isValidEmail(purchaseForm.recipientEmail)) {
      toast.error('Enter a valid recipient email address');
      return false;
    }
    if (purchaseForm.sendToRecipient && purchaseForm.recipientDeliveryAt) {
      const deliveryAt = new Date(purchaseForm.recipientDeliveryAt);
      if (!Number.isFinite(deliveryAt.getTime())) {
        toast.error('Choose a valid recipient send date/time');
        return false;
      }
      if (deliveryAt.getTime() < Date.now()) {
        toast.error('Recipient send date/time must be in the future');
        return false;
      }
    }

    return true;
  };

  const startManualPurchaseRequest = () => {
    if (!selectedProduct) return;
    if (!validatePurchaseForm()) return;

    window.location.href = buildMailtoHref(selectedProduct, purchaseForm);
    toast.success('Opening an email to Bendigo Flying Club with the voucher details');
  };

  const startCheckout = async () => {
    if (!selectedProduct) return;
    if (!selectedProduct.bookingAvailable) {
      toast.error('This voucher is temporarily unavailable online.');
      return;
    }
    if (!selectedProduct.checkoutAvailable) {
      toast('Online card payment is not enabled for this voucher yet. Use the manual request option and the club can issue it for you.');
      setPurchaseMode('manual');
      return;
    }
    if (!validatePurchaseForm()) return;

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
      if (!data?.checkoutUrl) throw new Error('Could not open the payment page');
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
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-blue-200" />
                <p>Send the voucher to yourself, or schedule it to arrive for the recipient.</p>
              </div>
              <div className="flex gap-3 rounded-2xl bg-white/10 p-4">
                <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-blue-200" />
                <p>The recipient can use their voucher code to choose a suitable flight time online.</p>
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
            ) : productsError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-950">
                <h4 className="text-lg font-bold">Voucher options could not load</h4>
                <p className="mt-2 text-sm leading-6 text-amber-800">
                  Voucher options could not be loaded right now.
                </p>
                <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-amber-800">
                  {productsError}
                </p>
                <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void loadProducts()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-700"
                  >
                    <Loader2 className="h-4 w-4" />
                    Try again
                  </button>
                  <a
                    href={mailtoHref}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100"
                  >
                    <Mail className="h-4 w-4" />
                    Contact the club
                  </a>
                </div>
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
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Flight</p>
                        <p className="font-bold">{product.durationMinutes} min</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Delivery</p>
                        <p className="font-bold">Email voucher</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {product.checkoutAvailable ? (
                        <button
                          type="button"
                          onClick={() => resetPurchaseForm(product, 'checkout')}
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
                        <button
                          type="button"
                          onClick={() => resetPurchaseForm(product, 'manual')}
                          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-600"
                        >
                          Request voucher
                          <ArrowRight className="h-4 w-4" />
                        </button>
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
                        This voucher is temporarily unavailable online. Please contact the club.
                      </div>
                    )}
                    {product.bookingAvailable && !product.checkoutAvailable && (
                      <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                        Contact the club and we can issue this voucher for you.
                      </div>
                    )}
                  </article>
                ))}
                {missingStandardOptions.map(option => (
                  <article key={option.mode} className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h4 className="text-lg font-bold text-slate-950">{option.name}</h4>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{option.description}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-200 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">
                        Coming soon
                      </span>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Flight</p>
                        <p className="font-bold">To be confirmed</p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Delivery</p>
                        <p className="font-bold">Email voucher</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <a
                        href={buildMailtoHref({
                          id: option.mode,
                          name: option.name,
                          description: option.description,
                          aircraftMode: option.mode,
                          durationMinutes: 0,
                          bookingBlockMinutes: 30,
                          price: 0,
                        })}
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-blue-700 ring-1 ring-slate-200 hover:bg-blue-50"
                      >
                        Contact to register interest
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-600">
                Voucher products have not been published yet. Contact Bendigo Flying Club and we can arrange a trial instructional flight voucher manually.
              </div>
            )}

            <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              Prefer to speak with someone first? Contact Bendigo Flying Club and we can arrange the voucher for you.
            </div>
          </section>
        </main>
      </div>
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                  {purchaseMode === 'checkout' ? 'Secure checkout' : 'Manual voucher request'}
                </p>
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
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                {purchaseMode === 'checkout'
                  ? 'By default the voucher email goes to the purchaser, so you can forward it or print it when you are ready. Tick direct recipient delivery if you want the voucher emailed to the recipient after payment, either immediately or at the date and time you choose.'
                  : 'Online card payment is not enabled for this voucher yet. Enter the details below and we will open a prefilled email to the club so staff can take payment, issue the voucher, and schedule recipient delivery if needed.'}
              </div>
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
              {purchaseMode === 'checkout' ? (
                <button
                  type="button"
                  onClick={startCheckout}
                  disabled={checkoutLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                  Continue to card payment
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startManualPurchaseRequest}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white transition hover:bg-amber-600"
                >
                  <Mail className="h-4 w-4" />
                  Email voucher request
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrialVoucherSalesPage;
