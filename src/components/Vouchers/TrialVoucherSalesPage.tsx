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
  aircraftOptions?: Array<{
    id: string;
    label: string;
    make: string;
    model: string;
    iconKey?: string;
  }>;
  addons?: Array<{
    id: string;
    name: string;
    description: string;
    price: number;
  }>;
}

interface PublicAircraftChoice {
  key: string;
  product: PublicVoucherProduct;
  label: string;
  model: string;
  iconKey?: string;
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

const buildAircraftChoiceKey = (option: { label?: string; make?: string; model?: string; iconKey?: string }) => {
  const label = (option.make || option.label || 'Aircraft').trim().toLowerCase();
  const model = String(option.model || '').trim().toLowerCase();
  const fallbackType = String(option.iconKey || '').trim().toLowerCase();

  if (label || model) {
    return `${label}|${model}`;
  }

  return fallbackType || 'aircraft';
};

export const TrialVoucherSalesPage: React.FC = () => {
  const [products, setProducts] = useState<PublicVoucherProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [adminContactEmails, setAdminContactEmails] = useState<string[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus | null>(null);
  const [checkoutStatusLoading, setCheckoutStatusLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<PublicVoucherProduct | null>(null);
  const [selectedCatalogProductId, setSelectedCatalogProductId] = useState<string>('');
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [showImmediateRecipientWarning, setShowImmediateRecipientWarning] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<'checkout' | 'manual' | 'book-now'>('checkout');
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
  const selectedCatalogProduct = useMemo(
    () => products.find(product => product.id === selectedCatalogProductId) || products[0] || null,
    [products, selectedCatalogProductId]
  );
  const selectedProductAddons = selectedProduct?.addons || [];
  const selectedAddons = selectedProductAddons.filter(addon => selectedAddonIds.includes(addon.id));
  const selectedAddonsTotal = selectedAddons.reduce((total, addon) => total + Number(addon.price || 0), 0);
  const selectedCheckoutTotal = selectedProduct ? Number(selectedProduct.price || 0) + selectedAddonsTotal : 0;
  const groupedDurations = useMemo(
    () => Array.from(new Set(products.map(product => product.durationMinutes))).sort((a, b) => a - b),
    [products]
  );
  const productAircraftChoices = useMemo<PublicAircraftChoice[]>(() => {
    if (!selectedCatalogProduct) return [];
    const choicesByType = new Map<string, PublicAircraftChoice>();
    const productsForDuration = products.filter(product => product.durationMinutes === selectedCatalogProduct.durationMinutes);

    productsForDuration.forEach(product => {
      const options = product.aircraftOptions || [];
      if (options.length === 0) {
        const key = `product:${product.id}`;
        if (!choicesByType.has(key)) {
          choicesByType.set(key, {
            key,
            product,
            label: product.name,
            model: '',
            iconKey: 'tecnam',
          });
        }
        return;
      }

      options.forEach(option => {
        const label = option.make || option.label || 'Aircraft';
        const model = option.model || '';
        const key = buildAircraftChoiceKey(option);
        const existing = choicesByType.get(key);
        if (existing) {
          if (!existing.iconKey && option.iconKey) {
            choicesByType.set(key, {
              ...existing,
              iconKey: option.iconKey,
            });
          }
          return;
        }
        choicesByType.set(key, {
          key,
          product,
          label,
          model,
          iconKey: option.iconKey,
        });
      });
    });

    return Array.from(choicesByType.values()).sort((a, b) =>
      `${a.label} ${a.model}`.localeCompare(`${b.label} ${b.model}`)
    );
  }, [products, selectedCatalogProduct]);
  const selectedAircraftChoiceKey = useMemo(() => {
    if (!selectedCatalogProduct) return '';
    const option = selectedCatalogProduct.aircraftOptions?.[0];
    return option ? buildAircraftChoiceKey(option) : `product:${selectedCatalogProduct.id}`;
  }, [selectedCatalogProduct]);
  const handleDurationSelect = (duration: number) => {
    const currentChoice = productAircraftChoices.find(choice => choice.key === selectedAircraftChoiceKey);
    const candidates = products.filter(product => product.durationMinutes === duration);
    const matchingChoice = currentChoice
      ? candidates.find(product =>
          (product.aircraftOptions || []).some(option => {
            return buildAircraftChoiceKey(option) === currentChoice.key;
          })
        )
      : null;
    setSelectedCatalogProductId((matchingChoice || candidates[0])?.id || '');
  };
  const iconSrcFor = (key?: string) => {
    const normalised = String(key || '').toLowerCase();
    if (['tecnam', 'piper', 'cessna', 'sling', 'twin'].includes(normalised)) {
      return `/aircraft-icons/${normalised}.png`;
    }
    return '/aircraft-icons/tecnam.png';
  };

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setProductsError('');
    try {
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: { action: 'products' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const nextProducts = data?.products || [];
      setProducts(nextProducts);
      setSelectedCatalogProductId(current => current || nextProducts[0]?.id || '');
      setAdminContactEmails(Array.isArray(data?.contactEmails) ? data.contactEmails : []);
    } catch (error) {
      console.error('Failed to load trial flight voucher products:', error);
      setProducts([]);
      setAdminContactEmails([]);
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
        if (nextStatus?.paymentStatus === 'paid' && params.get('intent') === 'book' && nextStatus.code) {
          window.location.href = `/trial-flight-voucher?voucherCode=${encodeURIComponent(nextStatus.code)}`;
          return;
        }
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
    const recipients = adminContactEmails.length > 0
      ? adminContactEmails.join(',')
      : 'info@bendigoflyingclub.com.au';
    const subject = encodeURIComponent('Trial flight gift voucher purchase');
    const voucherLines = product
      ? [
          `Preferred voucher: ${product.name}`,
          `Flight time: ${product.durationMinutes} minutes`,
          `Advertised price: ${formatPrice(product.price)}`,
          ...(selectedAddons.length > 0
            ? [
                'Selected add-ons:',
                ...selectedAddons.map(addon => `- ${addon.name}: ${formatPrice(addon.price)}`),
              ]
            : []),
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
    return `mailto:${recipients}?subject=${subject}&body=${body}`;
  };
  const mailtoHref = useMemo(() => buildMailtoHref(), [adminContactEmails]);

  const resetPurchaseForm = (
    product?: PublicVoucherProduct | null,
    mode: 'checkout' | 'manual' | 'book-now' = 'checkout'
  ) => {
    setSelectedProduct(product || null);
    setSelectedAddonIds([]);
    setShowImmediateRecipientWarning(false);
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

  const proceedToCheckout = async () => {
    if (!selectedProduct) return;

    setShowImmediateRecipientWarning(false);
    setCheckoutLoading(true);
    try {
      const origin = window.location.origin;
      const { data, error } = await supabase.functions.invoke('create-trial-voucher-checkout', {
        body: {
          productId: selectedProduct.id,
          addonIds: selectedAddonIds,
          ...purchaseForm,
          recipientDeliveryAt: purchaseForm.recipientDeliveryAt
            ? new Date(purchaseForm.recipientDeliveryAt).toISOString()
            : undefined,
          successUrl: `${origin}/trial-flight-gift-vouchers?checkout=success${purchaseMode === 'book-now' ? '&intent=book' : ''}`,
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

    if (purchaseForm.sendToRecipient && !purchaseForm.recipientDeliveryAt) {
      setShowImmediateRecipientWarning(true);
      return;
    }

    await proceedToCheckout();
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

        <main className="grid flex-1 gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="rounded-3xl bg-gradient-to-br from-blue-900 via-slate-900 to-slate-950 p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
            <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
              <Gift className="h-7 w-7 text-blue-100" />
            </div>
            <h2 className="text-3xl font-bold leading-tight">What is a trial flight?</h2>
            <p className="mt-4 leading-7 text-blue-100">
              A trial instructional flight is a hands-on first lesson with a qualified Bendigo Flying Club instructor. The participant sits in the pilot seat, learns the basics, and gets a real feel for what flying training is like.
            </p>
            <div className="mt-6 grid gap-3 text-sm text-blue-50">
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="font-bold">Before the flight</p>
                <p className="mt-1 text-blue-100">A short welcome, safety briefing, and explanation of what will happen in the aircraft.</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="font-bold">During the flight</p>
                <p className="mt-1 text-blue-100">The instructor guides the experience and may let the participant follow through on the controls when suitable.</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="font-bold">Afterwards</p>
                <p className="mt-1 text-blue-100">Time to ask questions about learning to fly, club membership, and next steps.</p>
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
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Choose your voucher</p>
                <h3 className="mt-1 text-2xl font-bold">Select a flight length and aircraft style</h3>
              </div>
              <a href={mailtoHref} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                <Mail className="h-4 w-4" />
                Ask a question
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
                <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-amber-800">{productsError}</p>
                <button type="button" onClick={() => void loadProducts()} className="mt-4 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-700">Try again</button>
              </div>
            ) : selectedCatalogProduct ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-sm font-bold text-slate-700">1. Flight length</p>
                  <div className="flex flex-wrap gap-2">
                    {groupedDurations.map(duration => {
                      const active = selectedCatalogProduct.durationMinutes === duration;
                      return (
                        <button
                          key={duration}
                          type="button"
                          onClick={() => handleDurationSelect(duration)}
                          className={`rounded-2xl border px-5 py-3 text-left transition ${active ? 'border-blue-500 bg-blue-50 text-blue-900 ring-2 ring-blue-100' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/50'}`}
                        >
                          <span className="block text-lg font-black">{duration} min</span>
                          <span className="text-xs font-semibold text-slate-500">Select aircraft for price</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-bold text-slate-700">2. Aircraft for this flight</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {productAircraftChoices.map(choice => (
                      <button
                        key={choice.key}
                        type="button"
                        onClick={() => setSelectedCatalogProductId(choice.product.id)}
                        className={`rounded-2xl border p-3 text-center transition ${
                          choice.key === selectedAircraftChoiceKey
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                            : 'border-slate-200 bg-slate-50 hover:border-blue-200 hover:bg-blue-50/50'
                        }`}
                      >
                        <img src={iconSrcFor(choice.iconKey)} alt="" className="mx-auto h-20 w-full object-contain" />
                        <p className="mt-2 text-sm font-black text-slate-900">{choice.label}</p>
                        {choice.model && <p className="text-xs font-semibold text-slate-500">{choice.model}</p>}
                      </button>
                    ))}
                    {productAircraftChoices.length === 0 && (
                      <div className="col-span-full rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        Aircraft are being finalised for this voucher. Contact the club before purchasing.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Price</p>
                  <p className="mt-1 text-3xl font-black text-blue-950">{formatPrice(selectedCatalogProduct.price)}</p>
                  <p className="mt-2 text-sm leading-6 text-blue-900">{selectedCatalogProduct.description}</p>
                </div>

                {selectedCatalogProduct.addons && selectedCatalogProduct.addons.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-bold text-slate-700">Optional extras</p>
                    <div className="grid gap-2">
                      {selectedCatalogProduct.addons.map(addon => (
                        <div key={addon.id} className="rounded-2xl border border-slate-200 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-bold text-slate-950">{addon.name}</p>
                              <p className="mt-1 text-sm leading-5 text-slate-600">{addon.description}</p>
                            </div>
                            <p className="shrink-0 font-black text-slate-950">{formatPrice(addon.price)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => resetPurchaseForm(selectedCatalogProduct, 'book-now')}
                    disabled={!selectedCatalogProduct.checkoutAvailable}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Book now after purchase
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => resetPurchaseForm(selectedCatalogProduct, selectedCatalogProduct.checkoutAvailable ? 'checkout' : 'manual')}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-5 py-4 text-sm font-black text-slate-800 transition hover:bg-slate-50"
                  >
                    Buy gift certificate
                    <Gift className="h-4 w-4" />
                  </button>
                </div>
                {!selectedCatalogProduct.checkoutAvailable && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                    Online payment is not ready for this voucher. You can still contact the club to purchase.
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-600">
                Voucher products have not been published yet. Contact Bendigo Flying Club and we can arrange a trial instructional flight voucher manually.
              </div>
            )}
          </section>
        </main>
      </div>
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                  {purchaseMode === 'manual' ? 'Manual voucher request' : purchaseMode === 'book-now' ? 'Book after checkout' : 'Gift certificate checkout'}
                </p>
                <h3 className="mt-1 text-2xl font-bold">{selectedProduct.name}</h3>
                <p className="mt-1 text-sm text-slate-600">{formatPrice(selectedCheckoutTotal)}</p>
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
                  : purchaseMode === 'book-now'
                    ? 'Choose any extras, complete payment, then use the voucher booking link to choose an available flight time.'
                  : 'Online card payment is not enabled for this voucher yet. Enter the details below and we will open a prefilled email to the club so staff can take payment, issue the voucher, and schedule recipient delivery if needed.'}
              </div>
              {selectedProductAddons.length > 0 && (
                <div className="rounded-2xl border border-slate-200 p-3">
                  <p className="mb-2 text-sm font-bold text-slate-800">Optional extras</p>
                  <div className="grid gap-2">
                    {selectedProductAddons.map(addon => (
                      <label key={addon.id} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
                        <input
                          type="checkbox"
                          checked={selectedAddonIds.includes(addon.id)}
                          onChange={event => setSelectedAddonIds(ids => event.target.checked ? [...ids, addon.id] : ids.filter(id => id !== addon.id))}
                          className="mt-1"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold text-slate-900">{addon.name}</span>
                          <span className="block text-xs leading-5 text-slate-600">{addon.description}</span>
                        </span>
                        <span className="shrink-0 text-sm font-black text-slate-950">{formatPrice(addon.price)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-2xl bg-slate-50 p-3 text-sm">
                <div className="flex justify-between"><span>Flight voucher</span><strong>{formatPrice(selectedProduct.price)}</strong></div>
                {selectedAddons.map(addon => (
                  <div key={addon.id} className="mt-1 flex justify-between text-slate-600"><span>{addon.name}</span><strong>{formatPrice(addon.price)}</strong></div>
                ))}
                <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-black"><span>Total</span><span>{formatPrice(selectedCheckoutTotal)}</span></div>
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
      {selectedProduct && showImmediateRecipientWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 px-4 py-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Mail className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold">Send voucher immediately?</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              You selected <strong>Send voucher direct to recipient</strong>, but did not choose a send date/time.
              If you continue to card payment and payment succeeds, the recipient will receive the voucher immediately.
            </p>
            <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
              Go back if this is meant to be a surprise for a birthday, Christmas, or another future date.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setShowImmediateRecipientWarning(false)}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Go back and choose time
              </button>
              <button
                type="button"
                onClick={() => void proceedToCheckout()}
                disabled={checkoutLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                Continue now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrialVoucherSalesPage;
