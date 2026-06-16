import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle, Copy, Download, ExternalLink, Mail, Pencil, Plane, Plus, Save, Search, ShieldCheck, Ticket, Users, XCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAircraft } from '../../hooks/useAircraft';
import { useTrialFlightVouchers } from '../../hooks/useTrialFlightVouchers';
import { useUsers } from '../../hooks/useUsers';
import { TrialFlightVoucher, TrialFlightVoucherAircraftMode, TrialFlightVoucherPaymentStatus, TrialFlightVoucherProduct } from '../../types';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

const defaultEmailBody =
  'This voucher includes a pre-flight welcome, a trial instructional flight with a qualified instructor, and time to ask questions about learning to fly at Bendigo Flying Club.';

const emptyProduct = (): Omit<TrialFlightVoucherProduct, 'id' | 'createdAt' | 'updatedAt'> => ({
  name: '',
  description: '',
  aircraftMode: 'tecnam',
  aircraftIds: [],
  instructorIds: [],
  durationMinutes: 60,
  price: 0,
  stripePriceId: '',
  emailSubject: 'Your Bendigo Flying Club trial flight voucher',
  emailBody: defaultEmailBody,
  bookingInstructions: 'Use the voucher code or link in this email to choose an available time. Please allow at least 30 minutes either side of the flight for briefing and paperwork.',
  isActive: true,
});

const buildPresetProduct = (
  aircraftMode: TrialFlightVoucherAircraftMode,
  instructorIds: string[],
): Omit<TrialFlightVoucherProduct, 'id' | 'createdAt' | 'updatedAt'> => {
  const isArcher = aircraftMode === 'archer';
  const aircraftName = isArcher ? 'PA-28 Archer' : 'Tecnam';
  const name = `${aircraftName} Trial Instructional Flight`;

  return {
    ...emptyProduct(),
    name,
    aircraftMode,
    instructorIds,
    description: `A ${aircraftName} trial instructional flight voucher for someone who wants to experience flying from Bendigo Flying Club with a qualified instructor.`,
    emailSubject: `Your Bendigo Flying Club ${aircraftName} trial flight voucher`,
    emailBody: `This voucher includes a pre-flight welcome, a ${aircraftName} trial instructional flight with a qualified instructor, and time to ask questions about learning to fly at Bendigo Flying Club.`,
    bookingInstructions: `Use the voucher code or link in this email to choose an available ${aircraftName} trial flight time. The booking system allows the flight duration plus 30 minutes for briefing, paperwork and aircraft changeover.`,
    isActive: true,
  };
};

const dateTimeLocalToIso = (value: string) => value ? new Date(value).toISOString() : undefined;
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const aircraftSearchLabel = (item: { registration?: string; make?: string; model?: string; type?: string }) =>
  `${item.registration || ''} ${item.make || ''} ${item.model || ''} ${item.type || ''}`.toLowerCase();
const isTecnamAircraft = (item: { registration?: string; make?: string; model?: string; type?: string }) =>
  aircraftSearchLabel(item).includes('tecnam');
const isArcherAircraft = (item: { registration?: string; make?: string; model?: string; type?: string }) => {
  const label = aircraftSearchLabel(item);
  const compact = label.replace(/[^a-z0-9]/g, '');
  return label.includes('archer') || compact.includes('pa28') || compact.includes('piperpa28');
};
const isValidStripePriceId = (value?: string) => !value?.trim() || /^price_[A-Za-z0-9_]+$/.test(value.trim());

const toDateTimeLocalValue = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const toDateInputValue = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
};

const defaultVoucherExpiryDate = () => {
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 3);
  return toDateInputValue(expiry);
};

const emptyIssueForm = () => ({
  productId: '',
  purchaserName: '',
  purchaserEmail: '',
  purchaserPhone: '',
  recipientName: '',
  recipientEmail: '',
  sendToRecipient: false,
  recipientDeliveryAt: '',
  expiresAt: defaultVoucherExpiryDate(),
  paymentStatus: 'paid' as TrialFlightVoucherPaymentStatus,
  notes: '',
});

const extractFunctionErrorMessage = async (error: unknown, fallback: string) => {
  const defaultMessage = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || fallback)
    : fallback;

  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: unknown }).context
    : null;

  if (!context || typeof context !== 'object' || typeof (context as Response).text !== 'function') {
    return defaultMessage;
  }

  try {
    const bodyText = await (context as Response).clone().text();
    if (!bodyText) return defaultMessage;
    try {
      const parsed = JSON.parse(bodyText) as { error?: unknown; message?: unknown };
      return String(parsed.error || parsed.message || '').trim() || defaultMessage;
    } catch {
      return bodyText.trim() || defaultMessage;
    }
  } catch {
    return defaultMessage;
  }
};

interface InstructorEndorsementRow {
  student_id: string;
  type: string;
  expiry_date?: string | null;
  is_active?: boolean | null;
}

interface StripePriceValidationResult {
  valid: boolean;
  configured?: boolean;
  issues?: string[];
  price?: {
    id: string;
    active: boolean;
    currency: string;
    unitAmount: number | null;
    productId?: string | null;
    productName?: string | null;
    productActive?: boolean | null;
    livemode: boolean;
  };
}

interface StripePriceCreationResult {
  created: boolean;
  productId: string;
  accountId?: string;
  stripeProduct?: {
    id: string;
    name?: string;
    active: boolean;
    livemode: boolean;
  };
  price?: {
    id: string;
    active: boolean;
    currency: string;
    unitAmount: number | null;
    livemode: boolean;
  };
}

interface StripeConnectStatus {
  connected: boolean;
  configured: boolean;
  livemode: boolean;
  accountId: string | null;
  connectedAt: string | null;
}

type VoucherAdminTab = 'products' | 'issue' | 'recent';

export const TrialFlightVouchersPage: React.FC = () => {
  const { user } = useAuth();
  const { aircraft } = useAircraft();
  const { users, getInstructors } = useUsers();
  const { products, vouchers, loading, refetch, saveProduct, issueVoucher, sendVoucherEmail, markVoucherReady, processDueVoucherEmails, releaseVoucherBooking, cancelVoucher } = useTrialFlightVouchers();
  const [productForm, setProductForm] = useState(emptyProduct);
  const [editingProductId, setEditingProductId] = useState<string | undefined>();
  const [showProductForm, setShowProductForm] = useState(false);
  const [instructorEndorsements, setInstructorEndorsements] = useState<InstructorEndorsementRow[]>([]);
  const [issueForm, setIssueForm] = useState(emptyIssueForm);
  const [saving, setSaving] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<StripeConnectStatus | null>(null);
  const [stripeStatusLoading, setStripeStatusLoading] = useState(true);
  const [stripeValidation, setStripeValidation] = useState<StripePriceValidationResult | null>(null);
  const [stripeValidationLoading, setStripeValidationLoading] = useState(false);
  const [stripeCreationLoading, setStripeCreationLoading] = useState(false);
  const [activeVoucherTab, setActiveVoucherTab] = useState<VoucherAdminTab>('products');
  const [voucherSearch, setVoucherSearch] = useState('');

  const instructors = getInstructors();
  const activeProducts = products.filter(product => product.isActive);
  const selectedProduct = products.find(product => product.id === issueForm.productId);
  const minimumRecipientDeliveryAt = useMemo(() => toDateTimeLocalValue(new Date(Date.now() + 5 * 60_000)), []);
  const stripeConnected = Boolean(stripeStatus?.configured && stripeStatus?.connected);
  const stripeReadyLabel = stripeStatusLoading ? 'Checking' : stripeConnected ? 'Connected' : 'Needs setup';
  const productCheckoutReady = (product: TrialFlightVoucherProduct) =>
    stripeConnected && Boolean(product.stripePriceId?.trim()) && Number(product.price || 0) > 0;
  const checkoutReadyProducts = activeProducts.filter(productCheckoutReady);
  const checkoutSetupComplete = activeProducts.length > 0 && checkoutReadyProducts.length === activeProducts.length;
  const onlineRevenueReadyValue = checkoutReadyProducts.reduce((total, product) => total + Number(product.price || 0), 0);
  const bookedVoucherCount = vouchers.filter(voucher => voucher.status === 'booked').length;
  const hasTecnamProduct = products.some(product => product.aircraftMode === 'tecnam');
  const hasArcherProduct = products.some(product => product.aircraftMode === 'archer');
  const now = Date.now();
  const emailReadyStatuses = new Set(['issued', 'redeemed', 'booked']);
  const scheduledRecipientVouchers = vouchers.filter(voucher =>
    voucher.sendToRecipient &&
    voucher.recipientDeliveryAt &&
    !voucher.deliveredAt &&
    emailReadyStatuses.has(voucher.status)
  );
  const dueRecipientVouchers = scheduledRecipientVouchers.filter(voucher =>
    voucher.recipientDeliveryAt && voucher.recipientDeliveryAt.getTime() <= now
  );
  const futureRecipientVouchers = scheduledRecipientVouchers.filter(voucher =>
    voucher.recipientDeliveryAt && voucher.recipientDeliveryAt.getTime() > now
  );
  const sortedVouchers = [...vouchers]
    .sort((a, b) => {
      const aDue = dueRecipientVouchers.some(voucher => voucher.id === a.id);
      const bDue = dueRecipientVouchers.some(voucher => voucher.id === b.id);
      if (aDue !== bDue) return aDue ? -1 : 1;

      const aUndelivered = !a.deliveredAt && emailReadyStatuses.has(a.status);
      const bUndelivered = !b.deliveredAt && emailReadyStatuses.has(b.status);
      if (aUndelivered !== bUndelivered) return aUndelivered ? -1 : 1;

      return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);
    });
  const visibleRecentVouchers = sortedVouchers.filter(voucher => {
    const query = voucherSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      voucher.code,
      voucher.productName,
      voucher.purchaserName,
      voucher.purchaserEmail,
      voucher.recipientName,
      voucher.recipientEmail,
      voucher.redeemedByName,
      voucher.redeemedByEmail,
      voucher.status,
      voucher.paymentStatus,
      voucher.stripeCheckoutSessionId,
      voucher.bookedBooking?.aircraftRegistration,
      voucher.bookedBooking?.instructorName,
    ]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(query));
  });

  const aircraftByMode = useMemo(() => {
    const tecnams = aircraft.filter(isTecnamAircraft);
    const archers = aircraft.filter(isArcherAircraft);
    return { tecnams, archers };
  }, [aircraft]);

  const instructorIdsKey = useMemo(
    () => instructors.map(instructor => instructor.id).sort().join(','),
    [instructors]
  );

  useEffect(() => {
    const loadInstructorEndorsements = async () => {
      const instructorIds = instructorIdsKey ? instructorIdsKey.split(',').filter(Boolean) : [];
      if (instructorIds.length === 0) {
        setInstructorEndorsements([]);
        return;
      }

      const { data, error } = await supabase
        .from('endorsements')
        .select('student_id,type,expiry_date,is_active')
        .in('student_id', instructorIds);

      if (error) {
        console.warn('Failed to load instructor endorsements for voucher readiness:', error);
        setInstructorEndorsements([]);
        return;
      }

      setInstructorEndorsements(data || []);
    };

    void loadInstructorEndorsements();
  }, [instructorIdsKey]);

  useEffect(() => {
    setStripeValidation(null);
  }, [productForm.price, productForm.stripePriceId]);

  useEffect(() => {
    let active = true;

    const loadStripeStatus = async () => {
      setStripeStatusLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke<StripeConnectStatus>('stripe-connect', {
          body: { action: 'status' },
        });
        if (error) throw error;
        if (active) setStripeStatus(data ?? null);
      } catch (error) {
        console.warn('Failed to load Stripe connection status:', error);
        if (active) setStripeStatus(null);
      } finally {
        if (active) setStripeStatusLoading(false);
      }
    };

    void loadStripeStatus();
    return () => {
      active = false;
    };
  }, []);

  const updateArraySelection = (field: 'aircraftIds' | 'instructorIds', id: string, checked: boolean) => {
    setProductForm(form => ({
      ...form,
      [field]: checked
        ? Array.from(new Set([...form[field], id]))
        : form[field].filter(existing => existing !== id),
    }));
  };

  const startEdit = (product: TrialFlightVoucherProduct) => {
    setEditingProductId(product.id);
    setShowProductForm(true);
    setStripeValidation(null);
    setProductForm({
      name: product.name,
      description: product.description,
      aircraftMode: product.aircraftMode,
      aircraftIds: product.aircraftIds,
      instructorIds: product.instructorIds,
      durationMinutes: product.durationMinutes,
      price: product.price,
      stripePriceId: product.stripePriceId || '',
      emailSubject: product.emailSubject,
      emailBody: product.emailBody,
      bookingInstructions: product.bookingInstructions,
      isActive: product.isActive,
    });
  };

  const applyPreset = (aircraftMode: TrialFlightVoucherAircraftMode) => {
    setEditingProductId(undefined);
    setShowProductForm(true);
    setStripeValidation(null);
    setProductForm(buildPresetProduct(aircraftMode, instructors.map(instructor => instructor.id)));
    toast.success(`${modeLabel(aircraftMode)} voucher template loaded`);
  };

  const createStandardProducts = async () => {
    if (instructors.length === 0) {
      toast.error('Add at least one instructor before creating standard voucher products');
      return;
    }

    const missingModes: TrialFlightVoucherAircraftMode[] = [
      ...(!hasTecnamProduct ? ['tecnam' as const] : []),
      ...(!hasArcherProduct ? ['archer' as const] : []),
    ];

    if (missingModes.length === 0) {
      toast.success('Standard voucher products already exist');
      return;
    }

    setSaving(true);
    try {
      for (const mode of missingModes) {
        const product = buildPresetProduct(mode, instructors.map(instructor => instructor.id));
        await saveProduct({
          ...product,
          isActive: mode === 'archer' && aircraftByMode.archers.length === 0 ? false : product.isActive,
        });
      }

      if (!hasArcherProduct && aircraftByMode.archers.length === 0) {
        toast('Archer product was created inactive because no PA-28 Archer aircraft was found in the fleet.');
      } else {
        toast.success('Standard voucher products created');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProductActive = async (product: TrialFlightVoucherProduct) => {
    if (!product.isActive) {
      const readiness = bookingReadiness(product);
      if (!readiness.ready) {
        toast.error(`This voucher is not bookable yet: ${readiness.issues[0] || 'complete the aircraft and instructor setup first.'}`);
        return;
      }
    }

    setSaving(true);
    try {
      await saveProduct({ ...product, isActive: !product.isActive }, product.id);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!productForm.name.trim()) {
      toast.error('Voucher name is required');
      return;
    }
    if (!productForm.durationMinutes || productForm.durationMinutes < 15) {
      toast.error('Duration must be at least 15 minutes');
      return;
    }
    if (productForm.instructorIds.length === 0) {
      toast.error('Select at least one instructor who can fly this voucher');
      return;
    }
    if (productForm.aircraftMode === 'specific' && productForm.aircraftIds.length === 0) {
      toast.error('Select at least one aircraft for a selected-aircraft voucher');
      return;
    }
    if (productForm.aircraftMode === 'tecnam' && productForm.aircraftIds.length === 0 && aircraftByMode.tecnams.length === 0) {
      toast.error('No Tecnam aircraft were found in the fleet. Select specific aircraft or update the aircraft details first.');
      return;
    }
    if (productForm.aircraftMode === 'archer' && productForm.aircraftIds.length === 0 && aircraftByMode.archers.length === 0) {
      toast.error('No PA-28 Archer aircraft were found in the fleet. Select the Archer aircraft or update the aircraft details first.');
      return;
    }
    if (productForm.isActive) {
      const qualifiedInstructorSelected = productForm.instructorIds.some(instructorId =>
        productFormAircraft.serviceableAircraft.some(aircraftItem =>
          instructorHasAircraftEndorsement(instructorId, aircraftItem.id)
        )
      );
      if (!qualifiedInstructorSelected) {
        toast.error('Select at least one instructor who can fly at least one serviceable eligible aircraft before activating this voucher.');
        return;
      }
    }
    if (Number(productForm.price || 0) < 0) {
      toast.error('Voucher price cannot be negative');
      return;
    }
    if (!productForm.emailSubject.trim()) {
      toast.error('Voucher email subject is required');
      return;
    }
    if (!productForm.emailBody.trim()) {
      toast.error('Voucher email body is required');
      return;
    }
    if (!productForm.bookingInstructions.trim()) {
      toast.error('Booking instructions are required');
      return;
    }
    if (!isValidStripePriceId(productForm.stripePriceId)) {
      toast.error('Stripe Price ID must start with price_');
      return;
    }
    if (productForm.stripePriceId?.trim() && Number(productForm.price || 0) <= 0) {
      toast.error('Enter the CRM sale price before adding a Stripe Price ID');
      return;
    }
    if (productForm.isActive && Number(productForm.price || 0) > 0 && !productForm.stripePriceId?.trim()) {
      toast('Product will be saved for manual issue only. Add a Stripe Price ID when online sales are ready.');
    }

    setSaving(true);
    try {
      await saveProduct(productForm, editingProductId);
      setProductForm(emptyProduct());
      setEditingProductId(undefined);
      setShowProductForm(false);
      setStripeValidation(null);
    } finally {
      setSaving(false);
    }
  };

  const handleValidateStripePrice = async () => {
    if (!stripeConnected) {
      toast.error('Connect this club Stripe account in Settings > Integrations first');
      return;
    }
    const stripePriceId = productForm.stripePriceId?.trim() || '';
    if (!stripePriceId) {
      toast.error('Paste a Stripe Price ID first');
      return;
    }
    if (!isValidStripePriceId(stripePriceId)) {
      toast.error('Stripe Price ID must start with price_');
      return;
    }

    setStripeValidationLoading(true);
    setStripeValidation(null);
    try {
      const { data, error } = await supabase.functions.invoke('trial-voucher-admin', {
        body: {
          action: 'validate-stripe-price',
          stripePriceId,
          expectedAmount: Number(productForm.price || 0),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStripeValidation(data as StripePriceValidationResult);
      if (data?.valid) {
        toast.success('Stripe Price ID matches this voucher setup');
      } else {
        toast.error(data?.issues?.[0] || 'Stripe Price ID needs attention');
      }
    } catch (error) {
      console.error('Failed to validate Stripe price:', error);
      toast.error(await extractFunctionErrorMessage(error, 'Failed to validate Stripe Price ID'));
    } finally {
      setStripeValidationLoading(false);
    }
  };

  const handleCreateStripePrice = async () => {
    if (!stripeConnected) {
      toast.error('Connect this club Stripe account in Settings > Integrations first');
      return;
    }
    if (!editingProductId) {
      toast.error('Save the voucher product before connecting it to Stripe');
      return;
    }
    if (!productForm.name.trim()) {
      toast.error('Voucher name is required before creating a Stripe product');
      return;
    }
    if (Number(productForm.price || 0) <= 0) {
      toast.error('Enter the AUD sale price before creating a Stripe price');
      return;
    }
    if (!productForm.isActive) {
      toast.error('Activate the voucher product before creating a Stripe price');
      return;
    }
    if (productForm.stripePriceId?.trim()) {
      toast.error('This product already has a Stripe Price ID. Check it or clear it before creating a new one.');
      return;
    }

    setStripeCreationLoading(true);
    setStripeValidation(null);
    try {
      await saveProduct(productForm, editingProductId);
      const { data, error } = await supabase.functions.invoke('trial-voucher-admin', {
        body: {
          action: 'create-stripe-price',
          productId: editingProductId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = data as StripePriceCreationResult;
      const stripePriceId = result.price?.id;
      if (!stripePriceId) throw new Error('Stripe returned no Price ID');

      setProductForm(form => ({ ...form, stripePriceId }));
      setStripeValidation({
        valid: true,
        configured: true,
        issues: [],
        price: {
          id: stripePriceId,
          active: Boolean(result.price?.active),
          currency: result.price?.currency || 'AUD',
          unitAmount: result.price?.unitAmount ?? null,
          productId: result.stripeProduct?.id,
          productName: result.stripeProduct?.name,
          productActive: result.stripeProduct?.active ?? null,
          livemode: Boolean(result.price?.livemode),
        },
      });
      await refetch();
      toast.success('Stripe product and Price ID created');
    } catch (error) {
      console.error('Failed to create Stripe price:', error);
      toast.error(await extractFunctionErrorMessage(error, 'Failed to create Stripe Price ID'));
    } finally {
      setStripeCreationLoading(false);
    }
  };

  const resolveIssueButtonLabel = (status: TrialFlightVoucherPaymentStatus) => {
    if (status === 'paid') return 'Mark paid & send voucher';
    if (status === 'pending') return 'Save unpaid draft';
    if (status === 'waived') return 'Send complimentary voucher';
    return 'Send manual voucher';
  };

  const handleIssueVoucher = async (paymentStatusOverride?: TrialFlightVoucherPaymentStatus) => {
    const effectivePaymentStatus = paymentStatusOverride || issueForm.paymentStatus;
    if (!issueForm.productId || !issueForm.purchaserName || !issueForm.purchaserEmail) {
      toast.error('Select a voucher and enter purchaser name/email');
      return;
    }
    if (!isValidEmail(issueForm.purchaserEmail)) {
      toast.error('Enter a valid purchaser email address');
      return;
    }
    const productToIssue = products.find(product => product.id === issueForm.productId);
    if (!productToIssue) {
      toast.error('Select a valid voucher product');
      return;
    }
    const issueReadiness = bookingReadiness(productToIssue);
    if (!productToIssue.isActive || !issueReadiness.ready) {
      toast.error('This voucher product is not bookable yet. Fix the aircraft and instructor setup before issuing it.');
      return;
    }
    if (issueForm.sendToRecipient && !issueForm.recipientEmail) {
      toast.error('Recipient email is required when sending direct to recipient');
      return;
    }
    if (issueForm.sendToRecipient && !isValidEmail(issueForm.recipientEmail)) {
      toast.error('Enter a valid recipient email address');
      return;
    }
    if (issueForm.sendToRecipient && issueForm.recipientDeliveryAt) {
      const deliveryAt = new Date(issueForm.recipientDeliveryAt);
      if (!Number.isFinite(deliveryAt.getTime())) {
        toast.error('Choose a valid recipient send date/time');
        return;
      }
      if (deliveryAt.getTime() < Date.now()) {
        toast.error('Recipient send date/time must be in the future');
        return;
      }
    }

    setSaving(true);
    try {
      await issueVoucher({
        productId: issueForm.productId,
        purchaserName: issueForm.purchaserName,
        purchaserEmail: issueForm.purchaserEmail,
        purchaserPhone: issueForm.purchaserPhone,
        recipientName: issueForm.recipientName,
        recipientEmail: issueForm.recipientEmail,
        sendToRecipient: issueForm.sendToRecipient,
        recipientDeliveryAt: dateTimeLocalToIso(issueForm.recipientDeliveryAt),
        expiresAt: issueForm.expiresAt ? new Date(`${issueForm.expiresAt}T23:59:59`).toISOString() : undefined,
        paymentStatus: effectivePaymentStatus,
        paymentAmount: selectedProduct?.price,
        paymentCurrency: 'AUD',
        notes: issueForm.notes,
        createdBy: user?.id,
      });
      setIssueForm(emptyIssueForm());
    } finally {
      setSaving(false);
    }
  };

  const handleSendVoucherEmail = async (voucherId: string, force = false) => {
    setSaving(true);
    try {
      await sendVoucherEmail(voucherId, { force });
    } catch (error) {
      console.error('Failed to send voucher email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send voucher email');
    } finally {
      setSaving(false);
    }
  };

  const handleResendSetupLink = async (voucher: TrialFlightVoucher) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: {
          action: 'resend-setup',
          code: voucher.code,
          redirectTo: getRedeemUrl(voucher.code),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.setupEmailSent ? 'Voucher account setup link resent' : 'Setup link generated');
    } catch (error) {
      console.error('Failed to resend voucher setup link:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to resend setup link');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkVoucherReady = async (voucherId: string) => {
    setSaving(true);
    try {
      await markVoucherReady(voucherId, 'paid');
    } catch (error) {
      console.error('Failed to mark voucher ready:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to mark voucher ready');
    } finally {
      setSaving(false);
    }
  };

  const handleProcessDueEmails = async () => {
    setSaving(true);
    try {
      await processDueVoucherEmails();
    } catch (error) {
      console.error('Failed to process due voucher emails:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to process due voucher emails');
    } finally {
      setSaving(false);
    }
  };

  const handleReleaseVoucherBooking = async (voucher: TrialFlightVoucher) => {
    if (!voucher.bookedBooking) return;
    const confirmed = window.confirm(
      'Release this voucher booking? The linked calendar booking will be cancelled and the voucher holder will be able to choose a new time.'
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      await releaseVoucherBooking(voucher);
    } catch (error) {
      console.error('Failed to release voucher booking:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to release voucher booking');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelVoucher = async (voucher: TrialFlightVoucher) => {
    if (voucher.bookedBookingId || voucher.status === 'booked') {
      toast.error('Release the linked booking before cancelling this voucher.');
      return;
    }

    const reason = window.prompt(
      `Cancel voucher ${voucher.code}? This prevents it from being redeemed or booked. Add an optional reason:`,
      voucher.paymentStatus === 'pending' ? 'Abandoned or failed checkout' : ''
    );
    if (reason === null) return;

    setSaving(true);
    try {
      await cancelVoucher(voucher.id, reason);
    } catch (error) {
      console.error('Failed to cancel voucher:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to cancel voucher');
    } finally {
      setSaving(false);
    }
  };

  const getRedeemUrl = (code: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/trial-flight-voucher?voucherCode=${encodeURIComponent(code)}`;
  };

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch (error) {
      console.error(`Failed to copy ${label.toLowerCase()}:`, error);
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  };

  const escapeHtml = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const downloadVoucherCertificate = async (voucher: TrialFlightVoucher) => {
    const product = products.find(item => item.id === voucher.productId);
    const redeemUrl = getRedeemUrl(voucher.code);
    const recipient = voucher.recipientName || 'Gift voucher recipient';
    const productName = voucher.productName || product?.name || 'Trial Flight Gift Voucher';
    const duration = product?.durationMinutes ? `${product.durationMinutes} minute trial instructional flight` : 'Trial instructional flight';
    const bookingBlock = product?.durationMinutes ? `${product.durationMinutes + 30} minute booking block` : 'Flight time plus 30 minutes for briefing and paperwork';
    const aircraft = product ? modeLabel(product.aircraftMode) : 'Eligible aircraft';
    const expiry = voucher.expiresAt ? voucher.expiresAt.toLocaleDateString() : 'No expiry recorded';
    const fileName = `${productName}-${voucher.code}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      pdfDoc.setTitle(`${productName} - ${voucher.code}`);
      pdfDoc.setAuthor('Bendigo Flying Club');
      pdfDoc.setSubject('Trial flight voucher certificate');
      pdfDoc.setCreator('Bendigo Flying Club Members Flight Management System');

      const page = pdfDoc.addPage([842, 595]);
      const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const width = page.getWidth();
      const height = page.getHeight();
      const navy = rgb(0.03, 0.08, 0.18);
      const blue = rgb(0.12, 0.36, 0.82);
      const paleBlue = rgb(0.91, 0.96, 1);
      const borderBlue = rgb(0.68, 0.80, 0.96);
      const slate = rgb(0.24, 0.30, 0.40);
      const lightSlate = rgb(0.95, 0.97, 0.99);

      const wrapText = (text: string, fontSize: number, maxWidth: number, font = regular) => {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let line = '';
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(next, fontSize) <= maxWidth || !line) {
            line = next;
          } else {
            lines.push(line);
            line = word;
          }
        }
        if (line) lines.push(line);
        return lines;
      };

      const drawText = (text: string, x: number, y: number, options: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; maxWidth?: number; lineHeight?: number } = {}) => {
        const size = options.size ?? 12;
        const font = options.font ?? regular;
        const color = options.color ?? navy;
        const lines = options.maxWidth ? wrapText(text, size, options.maxWidth, font) : [text];
        const lineHeight = options.lineHeight ?? size + 4;
        lines.forEach((line, index) => {
          page.drawText(line, { x, y: y - index * lineHeight, size, font, color });
        });
        return y - Math.max(lines.length - 1, 0) * lineHeight;
      };

      const fittedFontSize = (text: string, font: typeof regular, maxWidth: number, preferredSize: number, minSize: number) => {
        let size = preferredSize;
        while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
          size -= 0.5;
        }
        return size;
      };

      const drawDetailBox = (label: string, value: string, x: number, y: number, boxWidth: number) => {
        page.drawRectangle({
          x,
          y: y - 58,
          width: boxWidth,
          height: 58,
          color: lightSlate,
          borderColor: rgb(0.86, 0.90, 0.95),
          borderWidth: 1,
        });
        drawText(label.toUpperCase(), x + 14, y - 18, { size: 8.5, font: bold, color: rgb(0.39, 0.45, 0.55) });
        drawText(value, x + 14, y - 38, { size: 13, font: bold, color: navy, maxWidth: boxWidth - 28, lineHeight: 14 });
      };

      page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.93, 0.96, 1) });
      page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, color: rgb(1, 1, 1), borderColor: borderBlue, borderWidth: 1.2 });
      page.drawRectangle({ x: 34, y: height - 196, width: width - 68, height: 162, color: navy });
      page.drawRectangle({ x: 34, y: height - 196, width: width - 68, height: 8, color: blue });

      drawText('BENDIGO FLYING CLUB', 68, height - 78, { size: 10, font: bold, color: rgb(0.74, 0.86, 1) });
      drawText('Trial Flight Gift Voucher', 68, height - 120, { size: 34, font: bold, color: rgb(1, 1, 1) });
      drawText(`${productName} for ${recipient}`, 68, height - 152, { size: 15, color: rgb(0.86, 0.92, 1), maxWidth: 440 });

      const codeBoxX = 518;
      const codeBoxWidth = 256;
      const codeTextX = codeBoxX + 18;
      const codeMaxWidth = codeBoxWidth - 36;
      const codeFontSize = fittedFontSize(voucher.code, bold, codeMaxWidth, 20, 12);
      page.drawRectangle({ x: codeBoxX, y: height - 157, width: codeBoxWidth, height: 78, color: paleBlue, borderColor: rgb(0.54, 0.70, 0.94), borderWidth: 1 });
      drawText('VOUCHER CODE', codeTextX, height - 105, { size: 8.5, font: bold, color: blue });
      drawText(voucher.code, codeTextX, height - 133, { size: codeFontSize, font: bold, color: navy });

      const boxY = height - 240;
      const boxWidth = 172;
      drawDetailBox('Flight', duration, 68, boxY, boxWidth);
      drawDetailBox('Booking block', bookingBlock, 254, boxY, boxWidth);
      drawDetailBox('Aircraft', aircraft, 440, boxY, boxWidth);
      drawDetailBox('Expiry', expiry, 626, boxY, 148);

      drawText('How to book', 68, height - 328, { size: 16, font: bold, color: navy });
      const steps = [
        'Visit the Bendigo Flying Club portal using the link below.',
        'Enter the voucher code and create the restricted booking account with full name, email and phone.',
        'Choose an available time. The system checks eligible aircraft and instructor availability together.',
      ];
      steps.forEach((step, index) => {
        const y = height - 360 - index * 34;
        page.drawCircle({ x: 78, y: y + 2, size: 10, color: blue });
        drawText(String(index + 1), 75, y - 2, { size: 9, font: bold, color: rgb(1, 1, 1) });
        drawText(step, 98, y + 6, { size: 12, color: slate, maxWidth: 660 });
      });

      page.drawRectangle({ x: 68, y: 96, width: 706, height: 54, color: lightSlate, borderColor: rgb(0.86, 0.90, 0.95), borderWidth: 1 });
      drawText('BOOKING LINK', 84, 130, { size: 8.5, font: bold, color: rgb(0.39, 0.45, 0.55) });
      drawText(redeemUrl, 84, 112, { size: 10.5, color: slate, maxWidth: 674, lineHeight: 13 });

      drawText(
        'This voucher reserves the trial flight time plus 30 minutes for arrival, briefing and paperwork. Please contact Bendigo Flying Club if you need help booking or changing the flight.',
        68,
        72,
        { size: 9.5, color: rgb(0.39, 0.45, 0.55), maxWidth: 706, lineHeight: 12 }
      );

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName || 'trial-flight-voucher'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Voucher PDF downloaded');
    } catch (error) {
      console.error('Failed to download voucher PDF:', error);
      toast.error('Failed to create voucher PDF');
    }
  };

  const modeLabel = (mode: TrialFlightVoucherAircraftMode) =>
    mode === 'tecnam' ? 'Any Tecnam' : mode === 'archer' ? 'PA-28 Archer' : 'Selected aircraft';

  const aircraftLabel = (item: { registration?: string; make?: string; model?: string }) =>
    [item.registration, item.make, item.model].filter(Boolean).join(' ').trim() || 'Unnamed aircraft';

  const compactList = (items: string[], emptyLabel: string, maxVisible = 3) => {
    if (items.length === 0) return emptyLabel;
    const visible = items.slice(0, maxVisible).join(', ');
    return items.length > maxVisible ? `${visible} +${items.length - maxVisible} more` : visible;
  };

  const formatMoney = (value: number) =>
    new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value || 0);

  const normaliseEndorsementType = (value?: string | null) => String(value || '').trim().toLowerCase();

  const instructorHasAircraftEndorsement = (instructorId: string, aircraftId: string) => {
    const aircraftItem = aircraft.find(item => item.id === aircraftId);
    const requiredType = normaliseEndorsementType(aircraftItem?.requiredEndorsementType);
    if (!requiredType) return true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return instructorEndorsements.some(endorsement => {
      if (endorsement.student_id !== instructorId) return false;
      if (endorsement.is_active === false) return false;
      if (normaliseEndorsementType(endorsement.type) !== requiredType) return false;
      if (!endorsement.expiry_date) return true;
      const expiry = new Date(`${endorsement.expiry_date}T23:59:59`);
      return expiry >= today;
    });
  };

  const paymentLabel = (status?: TrialFlightVoucherPaymentStatus) =>
    status === 'paid' ? 'Paid'
      : status === 'pending' ? 'Payment pending'
      : status === 'failed' ? 'Payment failed'
      : status === 'refunded' ? 'Refunded'
      : status === 'waived' ? 'Waived'
      : 'Manual issue';

  const paymentPillClass = (status?: TrialFlightVoucherPaymentStatus) =>
    status === 'paid'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
      : status === 'pending'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
        : status === 'failed'
          ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200'
          : status === 'refunded'
            ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-200'
            : 'bg-gray-100 text-gray-600 dark:bg-[#20242b] dark:text-gray-300';

  const voucherDeliveryDetails = (voucher: TrialFlightVoucher) => {
    if (voucher.sendToRecipient) {
      const scheduledTime = voucher.recipientDeliveryAt?.getTime();
      const isDue = Boolean(scheduledTime && scheduledTime <= now && !voucher.deliveredAt && emailReadyStatuses.has(voucher.status));
      return {
        label: 'Direct to recipient',
        name: voucher.recipientName || 'Recipient',
        email: voucher.recipientEmail || 'No recipient email set',
        schedule: voucher.recipientDeliveryAt
          ? `${isDue ? 'Due now' : 'Scheduled'} for ${voucher.recipientDeliveryAt.toLocaleString()}`
          : 'Sends as soon as the voucher is issued',
        state: voucher.deliveredAt ? 'delivered' : isDue ? 'due' : voucher.recipientDeliveryAt ? 'scheduled' : 'immediate',
      };
    }

    return {
      label: 'Purchaser forwards',
      name: voucher.purchaserName || 'Purchaser',
      email: voucher.purchaserEmail,
      schedule: 'Email is sent to the purchaser to forward or print when ready',
      state: voucher.deliveredAt ? 'delivered' : 'manual',
    };
  };

  const matchingAircraftCount =
    productForm.aircraftMode === 'tecnam'
      ? aircraftByMode.tecnams.length
      : productForm.aircraftMode === 'archer'
        ? aircraftByMode.archers.length
        : productForm.aircraftIds.length;
  const hasAircraftSetupWarning =
    (productForm.aircraftMode === 'specific' && productForm.aircraftIds.length === 0) ||
    (productForm.aircraftMode === 'tecnam' && productForm.aircraftIds.length === 0 && aircraftByMode.tecnams.length === 0) ||
    (productForm.aircraftMode === 'archer' && productForm.aircraftIds.length === 0 && aircraftByMode.archers.length === 0);
  const aircraftSetupText =
    productForm.aircraftMode === 'specific'
      ? 'Only the selected aircraft will be offered for this voucher.'
      : productForm.aircraftIds.length > 0
        ? `Only the ${productForm.aircraftIds.length} selected aircraft will be offered for this ${modeLabel(productForm.aircraftMode).toLowerCase()} voucher.`
        : `${matchingAircraftCount} ${modeLabel(productForm.aircraftMode).toLowerCase()} aircraft currently match this voucher rule.`;
  const productFormAircraft = useMemo(() => {
    const selectedAircraft = productForm.aircraftIds.length > 0
      ? aircraft.filter(item => productForm.aircraftIds.includes(item.id))
      : productForm.aircraftMode === 'tecnam'
        ? aircraftByMode.tecnams
        : productForm.aircraftMode === 'archer'
          ? aircraftByMode.archers
          : [];

    return {
      selectedAircraft,
      serviceableAircraft: selectedAircraft.filter(item => item.status === 'serviceable'),
    };
  }, [aircraft, aircraftByMode.archers, aircraftByMode.tecnams, productForm.aircraftIds, productForm.aircraftMode]);
  const instructorVoucherReadiness = (instructorId: string) => {
    if (productFormAircraft.selectedAircraft.length === 0) {
      return {
        ready: false,
        label: 'No aircraft match',
        detail: 'Add or select an eligible aircraft before this instructor can be qualified for the voucher.',
      };
    }
    if (productFormAircraft.serviceableAircraft.length === 0) {
      return {
        ready: false,
        label: 'No serviceable aircraft',
        detail: 'At least one eligible aircraft must be serviceable before this instructor can fly voucher bookings.',
      };
    }

    const qualifiedAircraft = productFormAircraft.serviceableAircraft.filter(item =>
      instructorHasAircraftEndorsement(instructorId, item.id)
    );
    const restrictedAircraft = productFormAircraft.serviceableAircraft.filter(item => item.requiredEndorsementType);

    if (qualifiedAircraft.length > 0) {
      return {
        ready: true,
        label: 'Can fly voucher',
        detail: `${qualifiedAircraft.length} eligible serviceable aircraft available for this instructor.`,
      };
    }

    const requiredTypes = Array.from(new Set(restrictedAircraft.map(item => item.requiredEndorsementType).filter(Boolean)));
    return {
      ready: false,
      label: 'Needs endorsement',
      detail: requiredTypes.length > 0
        ? `Needs active endorsement: ${requiredTypes.join(', ')}.`
        : 'This instructor does not currently match the eligible aircraft for this voucher.',
    };
  };
  const productFormStripeId = productForm.stripePriceId?.trim() || '';
  const productFormPrice = Number(productForm.price || 0);
  const productFormCheckoutReady = stripeConnected && productForm.isActive && productFormPrice > 0 && isValidStripePriceId(productFormStripeId) && Boolean(productFormStripeId);
  const productFormStripeIssues = [
    ...(!stripeConnected ? ['Connect Stripe in Settings > Integrations.'] : []),
    ...(productFormPrice <= 0 ? ['Enter the public AUD sale price.'] : []),
    ...(!productFormStripeId ? ['Create a Stripe product/price and paste the Price ID.'] : []),
    ...(productFormStripeId && !isValidStripePriceId(productFormStripeId) ? ['Stripe Price ID should look like price_123...'] : []),
    ...(!productForm.isActive ? ['Activate the product when it is ready to sell or issue.'] : []),
  ];
  const copyStripeSetupSummary = async () => {
    const summary = [
      `Product name: ${productForm.name || 'Trial instructional flight voucher'}`,
      `Price: AUD ${productFormPrice.toFixed(2)}`,
      `Flight duration: ${productForm.durationMinutes} minutes`,
      `Booking block: ${Number(productForm.durationMinutes || 0) + 30} minutes`,
      `Aircraft rule: ${modeLabel(productForm.aircraftMode)}`,
      `Description: ${productForm.description || ''}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      toast.success('Stripe setup summary copied');
    } catch {
      toast.error('Could not copy Stripe setup summary');
    }
  };

  const checkoutStatus = (product: TrialFlightVoucherProduct) => {
    if (!product.isActive) return { label: 'Manual setup', className: 'bg-gray-100 text-gray-600 dark:bg-[#20242b] dark:text-gray-300' };
    if (!stripeConnected) return { label: 'Stripe not connected', className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100' };
    if (productCheckoutReady(product)) return { label: 'Online checkout ready', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200' };
    if (!product.stripePriceId?.trim() && Number(product.price || 0) <= 0) {
      return { label: 'Missing price and Stripe ID', className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100' };
    }
    if (!product.stripePriceId?.trim()) return { label: 'Missing Stripe ID', className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100' };
    return { label: 'Missing price', className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100' };
  };

  const getProductAircraft = (product: TrialFlightVoucherProduct) => {
    const selectedAircraft = product.aircraftIds.length > 0
      ? aircraft.filter(item => product.aircraftIds.includes(item.id))
      : product.aircraftMode === 'tecnam'
        ? aircraftByMode.tecnams
        : product.aircraftMode === 'archer'
          ? aircraftByMode.archers
          : [];
    const serviceableAircraft = selectedAircraft.filter(item => item.status === 'serviceable');
    return {
      selectedAircraft,
      serviceableAircraft,
      missingSelectedCount: product.aircraftIds.filter(id => !aircraft.some(item => item.id === id)).length,
    };
  };

  const bookingReadiness = (product: TrialFlightVoucherProduct) => {
    const { selectedAircraft, serviceableAircraft, missingSelectedCount } = getProductAircraft(product);
    const eligibleInstructors = instructors.filter(instructor => product.instructorIds.includes(instructor.id));
    const qualifiedInstructors = eligibleInstructors.filter(instructor =>
      serviceableAircraft.some(aircraftItem => instructorHasAircraftEndorsement(instructor.id, aircraftItem.id))
    );
    const endorsementRestrictedAircraft = serviceableAircraft.filter(item => item.requiredEndorsementType);
    const issues = [
      ...(selectedAircraft.length === 0 ? ['No matching aircraft are set up for this voucher.'] : []),
      ...(serviceableAircraft.length === 0 && selectedAircraft.length > 0 ? ['No eligible aircraft are currently serviceable.'] : []),
      ...(eligibleInstructors.length === 0 ? ['No eligible instructors are selected.'] : []),
      ...(serviceableAircraft.length > 0 && eligibleInstructors.length > 0 && qualifiedInstructors.length === 0
        ? ['No selected instructor currently holds the required aircraft endorsement for the serviceable aircraft.']
        : []),
      ...(missingSelectedCount > 0 ? [`${missingSelectedCount} selected aircraft ${missingSelectedCount === 1 ? 'record is' : 'records are'} no longer in the fleet.`] : []),
    ];

    return {
      issues,
      aircraftCount: selectedAircraft.length,
      serviceableAircraftCount: serviceableAircraft.length,
      instructorCount: eligibleInstructors.length,
      qualifiedInstructorCount: qualifiedInstructors.length,
      endorsementRestrictedAircraftCount: endorsementRestrictedAircraft.length,
      ready: issues.length === 0,
    };
  };

  const productInstructorNames = (product: TrialFlightVoucherProduct) =>
    instructors
      .filter(instructor => product.instructorIds.includes(instructor.id))
      .map(instructor => instructor.name);

  const productNextActions = (product: TrialFlightVoucherProduct) => {
    const readiness = bookingReadiness(product);
    const actions = [
      ...(!product.isActive ? ['Activate this voucher product when it is ready to issue.'] : []),
      ...(readiness.aircraftCount === 0
        ? [
            product.aircraftMode === 'archer'
              ? 'Add the PA-28 Archer to Aircraft Fleet with make/model containing Archer or PA-28, set it serviceable, or select the Archer as a specific aircraft.'
              : product.aircraftMode === 'tecnam'
                ? 'Add at least one Tecnam aircraft to Aircraft Fleet and mark it serviceable, or select specific Tecnam aircraft.'
                : 'Select at least one aircraft for this voucher.'
          ]
        : []),
      ...(readiness.aircraftCount > 0 && readiness.serviceableAircraftCount === 0 ? ['Mark at least one eligible aircraft as serviceable.'] : []),
      ...(readiness.instructorCount === 0 ? ['Select at least one eligible instructor for this voucher.'] : []),
      ...(readiness.instructorCount > 0 && readiness.qualifiedInstructorCount === 0
        ? ['Select an instructor who holds the required endorsement for at least one serviceable aircraft.']
        : []),
      ...(!stripeConnected ? ['Connect Stripe in Settings > Integrations before online sales can open.'] : []),
      ...(Number(product.price || 0) <= 0 ? ['Enter the real AUD sale price before online checkout is enabled.'] : []),
      ...(!product.stripePriceId?.trim() ? ['Paste the matching Stripe Price ID, for example price_..., once the Stripe product is created.'] : []),
    ];
    return actions;
  };

  const standardReadiness = (mode: 'tecnam' | 'archer') => {
    const modeProducts = products.filter(product => product.aircraftMode === mode);
    const activeModeProducts = modeProducts.filter(product => product.isActive);
    const product = activeModeProducts[0] ?? modeProducts[0];
    const readiness = product ? bookingReadiness(product) : null;
    const issues = [
      ...(!product ? [`Create a ${modeLabel(mode)} voucher product.`] : []),
      ...(product && !product.isActive ? ['Product exists but is inactive.'] : []),
      ...(readiness?.issues ?? []),
      ...(product && !stripeConnected ? ['Connect this club Stripe account before online sales can open.'] : []),
      ...(product && stripeConnected && !productCheckoutReady(product) ? ['Add a real price and Stripe Price ID before online sales can open.'] : []),
    ];

    return {
      mode,
      product,
      readiness,
      issues,
      bookingReady: Boolean(product?.isActive && readiness?.ready),
      checkoutReady: Boolean(product?.isActive && readiness?.ready && productCheckoutReady(product)),
    };
  };

  const requiredVoucherReadiness = [
    standardReadiness('tecnam'),
    standardReadiness('archer'),
  ];
  const tecnamReadiness = requiredVoucherReadiness.find(item => item.mode === 'tecnam');
  const archerReadiness = requiredVoucherReadiness.find(item => item.mode === 'archer');
  const bookableStandardProducts = requiredVoucherReadiness.filter(item => item.bookingReady);
  const checkoutReadyStandardProducts = requiredVoucherReadiness.filter(item => item.checkoutReady);
  const manualIssueReady = requiredVoucherReadiness.length > 0 && bookableStandardProducts.length === requiredVoucherReadiness.length;
  const publicSalesReady = requiredVoucherReadiness.length > 0 && checkoutReadyStandardProducts.length === requiredVoucherReadiness.length;
  const standardReadinessSummary = [
    {
      label: 'Stripe',
      value: stripeReadyLabel,
      complete: stripeConnected,
      detail: stripeStatusLoading
        ? 'Checking the club Stripe connection.'
        : stripeConnected
          ? `Voucher checkout will use this club's ${stripeStatus?.livemode ? 'live' : 'test'} Stripe account.`
          : 'Connect this club Stripe account in Settings > Integrations.',
    },
    {
      label: 'Manual issue',
      value: activeProducts.length > 0 ? 'Ready' : 'No live products',
      complete: activeProducts.length > 0,
      detail: activeProducts.length > 0
        ? 'Staff can issue active vouchers for cash, EFT, complimentary or external payments.'
        : 'Create and activate at least one voucher product before issuing vouchers.',
    },
    {
      label: 'Online sales',
      value: checkoutSetupComplete ? 'Ready' : `${checkoutReadyProducts.length}/${activeProducts.length || 0}`,
      complete: checkoutSetupComplete,
      detail: checkoutSetupComplete
        ? `All active voucher products can be bought online. Current online menu value: ${formatMoney(onlineRevenueReadyValue)}.`
        : 'Online buttons only appear for products with Stripe connection, price, Price ID, serviceable aircraft and eligible instructors.',
    },
    {
      label: 'Scheduled email',
      value: dueRecipientVouchers.length > 0 ? 'Due' : 'Watching',
      complete: dueRecipientVouchers.length === 0,
      detail: dueRecipientVouchers.length > 0
        ? 'Run Send due now, then confirm GitHub Actions has SUPABASE_URL and TRIAL_VOUCHER_CRON_SECRET secrets.'
        : 'The CRM can send due emails manually, and GitHub Actions can run it automatically once secrets are set.',
    },
  ];
  const setupTasks = [
    {
      label: 'Tecnam voucher can be booked',
      complete: Boolean(tecnamReadiness?.bookingReady),
      detail: tecnamReadiness?.bookingReady
        ? `${tecnamReadiness.readiness?.serviceableAircraftCount ?? 0} serviceable Tecnam aircraft and ${tecnamReadiness.readiness?.qualifiedInstructorCount ?? 0} qualified instructor${tecnamReadiness.readiness?.qualifiedInstructorCount === 1 ? '' : 's'} are set.`
        : tecnamReadiness?.issues[0] || 'Create and activate the Tecnam voucher product.',
      href: '/aircraft',
      action: 'Review aircraft',
    },
    {
      label: 'Archer voucher can be booked',
      complete: Boolean(archerReadiness?.bookingReady),
      detail: archerReadiness?.bookingReady
        ? `${archerReadiness.readiness?.serviceableAircraftCount ?? 0} PA-28 Archer aircraft and ${archerReadiness.readiness?.qualifiedInstructorCount ?? 0} qualified instructor${archerReadiness.readiness?.qualifiedInstructorCount === 1 ? '' : 's'} are set.`
        : archerReadiness?.issues[0] || 'Add the PA-28 Archer to the fleet or select it manually on the Archer product.',
      href: '/aircraft',
      action: 'Add Archer',
    },
    {
      label: 'Stripe account is connected',
      complete: stripeConnected,
      detail: stripeStatusLoading
        ? 'Checking the Stripe connection for this club.'
        : stripeConnected
          ? `Connected to ${stripeStatus?.livemode ? 'live' : 'test'} Stripe payments.`
          : 'Connect this club Stripe account in Settings > Integrations before online voucher checkout can open.',
      href: '/settings?tab=integrations',
      action: 'Open integrations',
    },
    {
      label: 'Online checkout is ready',
      complete: checkoutSetupComplete,
      detail: checkoutSetupComplete
        ? `${checkoutReadyProducts.length} active voucher product${checkoutReadyProducts.length === 1 ? '' : 's'} can be purchased online.`
        : `${checkoutReadyProducts.length} of ${activeProducts.length} active voucher product${activeProducts.length === 1 ? '' : 's'} are ready with Stripe connection, price and Price ID.`,
      href: '/trial-flight-gift-vouchers',
      action: 'Preview sales page',
    },
    {
      label: 'Scheduled delivery is monitored',
      complete: dueRecipientVouchers.length === 0,
      detail: dueRecipientVouchers.length === 0
        ? `${futureRecipientVouchers.length} future recipient email${futureRecipientVouchers.length === 1 ? '' : 's'} scheduled.`
        : `${dueRecipientVouchers.length} scheduled recipient email${dueRecipientVouchers.length === 1 ? ' is' : 's are'} due now.`,
      action: dueRecipientVouchers.length > 0 ? 'Send due now' : 'Checked',
      onClick: dueRecipientVouchers.length > 0 ? handleProcessDueEmails : undefined,
    },
  ];
  const selectedProductReadiness = selectedProduct ? bookingReadiness(selectedProduct) : null;
  const selectedProductIsIssueable = Boolean(selectedProduct?.isActive && selectedProductReadiness?.ready);

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-950 to-blue-800 p-5 text-white shadow-lg sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Trial instructional flights</p>
            <h1 className="mt-2 text-2xl font-bold">Gift Vouchers</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">
              Sell, issue and manage trial flight vouchers.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4 lg:min-w-[30rem]">
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <p className="text-lg font-bold">{activeProducts.length}</p>
              <p className="text-xs text-blue-100">Live products</p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <p className="text-lg font-bold">{checkoutReadyProducts.length}</p>
              <p className="text-xs text-blue-100">Online ready</p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <p className="text-lg font-bold">{bookedVoucherCount}</p>
              <p className="text-xs text-blue-100">Booked</p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <p className="text-lg font-bold">{formatMoney(onlineRevenueReadyValue)}</p>
              <p className="text-xs text-blue-100">Online menu</p>
            </div>
          </div>
        </div>
      </div>

      <section className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Stripe</p>
          <p className="mt-1 text-xl font-bold text-gray-950 dark:text-gray-100">{stripeReadyLabel}</p>
          <p className="mt-2 text-sm leading-5 text-gray-600 dark:text-gray-300">
            {stripeStatusLoading
              ? 'Checking payment connection...'
              : stripeConnected
                ? `${stripeStatus?.livemode ? 'Live' : 'Test'} checkout is connected.`
                : 'Connect Stripe before selling vouchers online.'}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Online sales</p>
          <p className="mt-1 text-xl font-bold text-gray-950 dark:text-gray-100">
            {checkoutReadyProducts.length}/{activeProducts.length || 0} ready
          </p>
          <p className="mt-2 text-sm leading-5 text-gray-600 dark:text-gray-300">
            Customers can buy checkout-ready products on the public voucher page.
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Scheduled emails</p>
          <p className="mt-1 text-xl font-bold text-gray-950 dark:text-gray-100">
            {dueRecipientVouchers.length > 0 ? `${dueRecipientVouchers.length} due` : `${futureRecipientVouchers.length} scheduled`}
          </p>
          {dueRecipientVouchers.length > 0 ? (
            <button
              type="button"
              onClick={handleProcessDueEmails}
              disabled={saving}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              <Mail className="h-4 w-4" />
              Send due now
            </button>
          ) : (
            <p className="mt-2 text-sm leading-5 text-gray-600 dark:text-gray-300">No voucher emails need action now.</p>
          )}
        </div>
      </section>

      {false && (
      <>
      <section className="mb-6 grid gap-3 lg:grid-cols-4">
        {standardReadinessSummary.map(item => (
          <div
            key={item.label}
            className={`rounded-2xl border p-4 shadow-sm ${
              item.complete
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/25 dark:bg-emerald-950/15'
                : 'border-amber-200 bg-amber-50 dark:border-amber-400/25 dark:bg-amber-950/15'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-950 dark:text-gray-100">{item.value}</p>
              </div>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                item.complete
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
              }`}>
                {item.complete ? <CheckCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Live sales products</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              These active products are what customers see on the public voucher page. Online products can take card payment immediately; manual products can still be issued by staff.
            </p>
          </div>
          <a
            href="/trial-flight-gift-vouchers"
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <ExternalLink className="h-4 w-4" />
            View public page
          </a>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {activeProducts.map(product => {
            const checkout = checkoutStatus(product);
            const booking = bookingReadiness(product);
            const productAircraft = getProductAircraft(product);
            const serviceableAircraftNames = productAircraft.serviceableAircraft.map(aircraftLabel);
            const instructorNames = productInstructorNames(product);
            const readyForCheckout = productCheckoutReady(product) && booking.ready;

            return (
              <article
                key={product.id}
                className={`rounded-2xl border p-4 shadow-sm ${
                  readyForCheckout
                    ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-400/25 dark:bg-emerald-950/15'
                    : booking.ready
                      ? 'border-blue-200 bg-blue-50/80 dark:border-blue-400/25 dark:bg-blue-950/15'
                      : 'border-amber-200 bg-amber-50/80 dark:border-amber-400/25 dark:bg-amber-950/15'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{modeLabel(product.aircraftMode)}</p>
                    <h3 className="mt-1 truncate text-base font-bold text-gray-950 dark:text-gray-100">{product.name}</h3>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {product.durationMinutes} min flight · {product.durationMinutes + 30} min booking block
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-black text-blue-700 dark:text-blue-200">{formatMoney(product.price)}</p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${checkout.className}`}>
                    {checkout.label}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    booking.ready
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                  }`}>
                    {booking.ready ? 'Booking ready' : 'No bookable times'}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-white/80 p-2 ring-1 ring-black/5 dark:bg-[#111827] dark:ring-white/10">
                    <p className="text-base font-bold text-gray-950 dark:text-gray-100">{booking.serviceableAircraftCount}</p>
                    <p className="text-gray-500 dark:text-gray-400">Aircraft</p>
                  </div>
                  <div className="rounded-xl bg-white/80 p-2 ring-1 ring-black/5 dark:bg-[#111827] dark:ring-white/10">
                    <p className="text-base font-bold text-gray-950 dark:text-gray-100">{booking.qualifiedInstructorCount}</p>
                    <p className="text-gray-500 dark:text-gray-400">Instructors</p>
                  </div>
                  <div className="rounded-xl bg-white/80 p-2 ring-1 ring-black/5 dark:bg-[#111827] dark:ring-white/10">
                    <p className="text-base font-bold text-gray-950 dark:text-gray-100">{product.stripePriceId ? 'Yes' : 'No'}</p>
                    <p className="text-gray-500 dark:text-gray-400">Stripe</p>
                  </div>
                </div>

                <div className="mt-3 space-y-2 text-xs leading-5 text-gray-600 dark:text-gray-300">
                  <p className="rounded-xl bg-white/70 px-3 py-2 dark:bg-[#111827]">
                    <span className="font-bold text-gray-900 dark:text-gray-100">Aircraft:</span>{' '}
                    {compactList(serviceableAircraftNames, 'No serviceable aircraft detected')}
                  </p>
                  <p className="rounded-xl bg-white/70 px-3 py-2 dark:bg-[#111827]">
                    <span className="font-bold text-gray-900 dark:text-gray-100">Instructors:</span>{' '}
                    {compactList(instructorNames, 'No instructors selected')}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => startEdit(product)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#111827] dark:text-gray-200 dark:hover:bg-[#20242b]"
                >
                  <Pencil className="h-4 w-4" />
                  Edit product
                </button>
              </article>
            );
          })}
          {activeProducts.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-[#363b45] dark:text-gray-400 xl:col-span-3">
              No active voucher products are currently visible on the public sales page.
            </div>
          )}
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Standard fleet readiness</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">
              These checks make sure at least one Tecnam option and one Archer option are ready. Extra voucher products can still be sold when they appear above as checkout ready.
            </p>
          </div>
          <button
            type="button"
            onClick={createStandardProducts}
            disabled={saving}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            Create missing standard products
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {requiredVoucherReadiness.map(item => {
            const isReady = item.checkoutReady;
            const isBookable = item.bookingReady;
            const product = item.product;
            const productAircraft = product ? getProductAircraft(product) : null;
            const aircraftNames = productAircraft?.serviceableAircraft.map(aircraftLabel) ?? [];
            const instructorNames = product ? productInstructorNames(product) : [];
            const nextActions = product ? productNextActions(product) : [`Create the ${modeLabel(item.mode)} voucher product.`];

            return (
              <div
                key={item.mode}
                className={`rounded-2xl border p-4 ${
                  isReady
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/25 dark:bg-emerald-950/15'
                    : isBookable
                      ? 'border-blue-200 bg-blue-50 dark:border-blue-400/25 dark:bg-blue-950/15'
                      : 'border-amber-200 bg-amber-50 dark:border-amber-400/25 dark:bg-amber-950/15'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-gray-950 dark:text-gray-100">{modeLabel(item.mode)}</h3>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        isReady
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                          : isBookable
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-100'
                      }`}>
                        {isReady ? 'Checkout ready' : isBookable ? 'Bookable manually' : 'Needs setup'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-gray-600 dark:text-gray-300">
                      {product?.name || 'No voucher product has been created yet.'}
                    </p>
                  </div>
                  {product ? (
                    <button
                      type="button"
                      onClick={() => startEdit(product)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#111827] dark:text-gray-200 dark:hover:bg-[#20242b]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => applyPreset(item.mode)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 dark:border-blue-400/30 dark:bg-[#111827] dark:text-blue-200 dark:hover:bg-blue-950/40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Draft
                    </button>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-white/70 bg-white/70 p-2 dark:border-[#2c2f36] dark:bg-[#111827]">
                    <p className="text-lg font-bold text-gray-950 dark:text-gray-100">{item.readiness?.serviceableAircraftCount ?? 0}</p>
                    <p className="text-gray-500 dark:text-gray-400">Aircraft</p>
                  </div>
                  <div className="rounded-xl border border-white/70 bg-white/70 p-2 dark:border-[#2c2f36] dark:bg-[#111827]">
                    <p className="text-lg font-bold text-gray-950 dark:text-gray-100">{item.readiness?.qualifiedInstructorCount ?? 0}</p>
                    <p className="text-gray-500 dark:text-gray-400">Qualified</p>
                  </div>
                  <div className="rounded-xl border border-white/70 bg-white/70 p-2 dark:border-[#2c2f36] dark:bg-[#111827]">
                    <p className="text-lg font-bold text-gray-950 dark:text-gray-100">{product?.stripePriceId ? 'Yes' : 'No'}</p>
                    <p className="text-gray-500 dark:text-gray-400">Stripe</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs leading-5 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/70 bg-white/70 p-3 dark:border-[#2c2f36] dark:bg-[#111827]">
                    <p className="font-bold text-gray-950 dark:text-gray-100">Detected aircraft</p>
                    <p className="mt-1 text-gray-600 dark:text-gray-300">
                      {compactList(aircraftNames, product ? 'No serviceable aircraft detected' : 'Create product first')}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/70 bg-white/70 p-3 dark:border-[#2c2f36] dark:bg-[#111827]">
                    <p className="font-bold text-gray-950 dark:text-gray-100">Selected instructors</p>
                    <p className="mt-1 text-gray-600 dark:text-gray-300">
                      {compactList(instructorNames, product ? 'No eligible instructors selected' : 'Create product first')}
                    </p>
                    {product && item.readiness && item.readiness.endorsementRestrictedAircraftCount > 0 && (
                      <p className="mt-1 text-amber-700 dark:text-amber-200">
                        {item.readiness.qualifiedInstructorCount} of {item.readiness.instructorCount} selected instructors match required aircraft endorsements.
                      </p>
                    )}
                  </div>
                </div>

                {item.issues.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {item.issues.map(issue => (
                      <p key={issue} className="flex gap-2 text-xs leading-5 text-gray-700 dark:text-gray-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
                        <span>{issue}</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 flex gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                    <CheckCircle className="h-4 w-4" />
                    Ready for online purchase and voucher booking.
                  </p>
                )}

                {nextActions.length > 0 && (
                  <div className="mt-3 rounded-xl border border-white/70 bg-white/80 p-3 dark:border-[#2c2f36] dark:bg-[#111827]">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Next actions</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-gray-700 dark:text-gray-300">
                      {nextActions.map(action => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className={`mb-6 rounded-2xl border p-4 shadow-sm dark:bg-[#171a21] sm:p-5 ${
        checkoutSetupComplete
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/25'
          : 'border-amber-200 bg-amber-50 dark:border-amber-400/25'
      }`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              checkoutSetupComplete
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
            }`}>
              {checkoutSetupComplete ? <CheckCircle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-bold ${
                checkoutSetupComplete
                  ? 'text-emerald-950 dark:text-emerald-100'
                  : 'text-amber-950 dark:text-amber-100'
              }`}>
                Online checkout setup
              </p>
              <p className={`mt-1 max-w-3xl text-sm leading-6 ${
                checkoutSetupComplete
                  ? 'text-emerald-800 dark:text-emerald-200'
                  : 'text-amber-800 dark:text-amber-100'
              }`}>
                {checkoutReadyProducts.length} of {activeProducts.length} active voucher product{activeProducts.length === 1 ? '' : 's'} are ready for online checkout.
                Public purchase buttons only appear for active products with a connected Stripe account, real price, Stripe Price ID, serviceable aircraft and eligible instructor.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <a
              href="/settings?tab=integrations"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#635bff] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5147f0]"
            >
              <ExternalLink className="h-4 w-4" />
              Stripe settings
            </a>
            <a
              href="/trial-flight-gift-vouchers"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/50 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm transition hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#111827] dark:text-gray-100 dark:hover:bg-[#20242b]"
            >
              <ExternalLink className="h-4 w-4" />
              Public sales page
            </a>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-xs leading-5 text-gray-700 dark:text-gray-300 lg:grid-cols-3">
          <div className="rounded-xl border border-white/70 bg-white/70 p-3 dark:border-[#2c2f36] dark:bg-[#111827]">
            <p className="font-bold text-gray-950 dark:text-gray-100">Products</p>
            <p className="mt-1">Keep Tecnam and PA-28 Archer products active, priced, and linked to eligible aircraft and instructors. Create a Stripe product/price from this page when the product should sell online.</p>
          </div>
          <div className="rounded-xl border border-white/70 bg-white/70 p-3 dark:border-[#2c2f36] dark:bg-[#111827]">
            <p className="font-bold text-gray-950 dark:text-gray-100">Stripe connection</p>
            <p className="mt-1">
              {stripeStatusLoading
                ? 'Checking Stripe connection...'
                : stripeConnected
                  ? `Stripe is connected for ${stripeStatus?.livemode ? 'live' : 'test'} checkout.`
                  : 'Connect this club Stripe account in Settings > Integrations before public checkout is available.'}
            </p>
          </div>
          <div className="rounded-xl border border-white/70 bg-white/70 p-3 dark:border-[#2c2f36] dark:bg-[#111827]">
            <p className="font-bold text-gray-950 dark:text-gray-100">Email delivery</p>
            <p className="mt-1">Voucher emails send immediately unless a future recipient delivery time is chosen. Scheduled delivery can be checked from the Recent vouchers section.</p>
          </div>
        </div>
      </div>

      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Go-live checklist</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              These are the remaining operational pieces that decide whether the trial voucher flow can be sold and booked end to end.
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 dark:bg-[#20242b] dark:text-gray-200">
            {setupTasks.filter(task => task.complete).length} of {setupTasks.length} ready
          </span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {setupTasks.map(task => (
            <div
              key={task.label}
              className={`rounded-xl border p-3 ${
                task.complete
                  ? 'border-emerald-100 bg-emerald-50 dark:border-emerald-400/20 dark:bg-emerald-950/15'
                  : 'border-amber-200 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-950/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  task.complete
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                }`}>
                  {task.complete ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-950 dark:text-gray-100">{task.label}</p>
                  <p className="mt-1 text-sm leading-5 text-gray-600 dark:text-gray-300">{task.detail}</p>
                  {task.href ? (
                    <a
                      href={task.href}
                      target={task.href.startsWith('/trial-flight-gift-vouchers') ? '_blank' : undefined}
                      rel={task.href.startsWith('/trial-flight-gift-vouchers') ? 'noreferrer' : undefined}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#111827] dark:text-gray-200 dark:hover:bg-[#20242b]"
                    >
                      {task.action}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : task.onClick ? (
                    <button
                      type="button"
                      onClick={task.onClick}
                      disabled={saving}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {task.action}
                    </button>
                  ) : (
                    <span className="mt-3 inline-flex rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-gray-600 dark:bg-[#111827] dark:text-gray-300">
                      {task.action}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      </>
      )}

      <div className="mb-6 overflow-x-auto">
        <div className="inline-flex min-w-full rounded-2xl border border-gray-200 bg-white p-1 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:min-w-0">
          {[
            { id: 'products' as const, label: 'Voucher products', count: products.length },
            { id: 'issue' as const, label: 'Issue voucher', count: activeProducts.length },
            { id: 'recent' as const, label: 'Recent vouchers', count: vouchers.length },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveVoucherTab(tab.id)}
              className={`flex min-w-[10rem] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition sm:flex-none ${
                activeVoucherTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-[#20242b]'
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-2 py-0.5 text-xs ${
                activeVoucherTab === tab.id
                  ? 'bg-white/20 text-white'
                  : 'bg-gray-100 text-gray-600 dark:bg-[#20242b] dark:text-gray-300'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {activeVoucherTab === 'products' && (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Voucher products</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Create, price and publish the voucher products shown on the public sales page.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingProductId(undefined);
                setProductForm(emptyProduct());
                setShowProductForm(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2c2f36] dark:text-gray-200 dark:hover:bg-[#111827]"
            >
              <Plus className="h-4 w-4" />
              New
            </button>
          </div>

          <div className="space-y-2">
            {products.map(product => {
              const checkout = checkoutStatus(product);
              const booking = bookingReadiness(product);
              return (
                <div
                  key={product.id}
                  className={`rounded-xl border p-3 transition ${
                    editingProductId === product.id
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-400/40 dark:bg-blue-950/20'
                      : 'border-gray-200 bg-white dark:border-[#2c2f36] dark:bg-[#111827]'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-gray-950 dark:text-gray-100">{product.name || 'Untitled voucher'}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          product.isActive
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'bg-gray-100 text-gray-600 dark:bg-[#20242b] dark:text-gray-300'
                        }`}>
                          {product.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${checkout.className}`}>
                          {checkout.label}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          booking.ready
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                        }`}>
                          {booking.ready ? 'Bookable' : 'No availability'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {modeLabel(product.aircraftMode)} - {product.durationMinutes} min flight - {formatMoney(product.price)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(product)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#20242b]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleProductActive(product)}
                        disabled={saving}
                        className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
                          product.isActive
                            ? 'border border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-400/30 dark:text-amber-200 dark:hover:bg-amber-950/30'
                            : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400/30 dark:text-emerald-200 dark:hover:bg-emerald-950/30'
                        }`}
                      >
                        {product.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {products.length === 0 && (
              <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-[#363b45] dark:text-gray-400">
                No voucher products yet. Create a voucher product before issuing vouchers.
              </p>
            )}
          </div>

          {showProductForm && (
          <>

          <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-400/20 dark:bg-blue-950/20">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-bold text-blue-950 dark:text-blue-100">Quick setup templates</p>
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  Load a standard voucher, then confirm price, aircraft and eligible instructors before saving.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[34rem]">
                <button
                  type="button"
                  onClick={createStandardProducts}
                  disabled={saving || (hasTecnamProduct && hasArcherProduct)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Create standard
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('tecnam')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-800 shadow-sm transition hover:bg-blue-50 dark:border-blue-400/30 dark:bg-[#111827] dark:text-blue-100 dark:hover:bg-blue-950/40"
                >
                  <Plane className="h-4 w-4" />
                  Tecnam voucher
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('archer')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-800 shadow-sm transition hover:bg-blue-50 dark:border-blue-400/30 dark:bg-[#111827] dark:text-blue-100 dark:hover:bg-blue-950/40"
                >
                  <Plane className="h-4 w-4" />
                  Archer voucher
                </button>
              </div>
            </div>
            {aircraftByMode.archers.length === 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
                No PA-28 Archer aircraft is currently detected in the fleet. Archer voucher products can be drafted, but they should stay inactive until the Archer aircraft exists and is serviceable.
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-gray-500">Voucher name</span>
              <input value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" placeholder="Tecnam Trial Instructional Flight" />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-gray-500">Flight minutes</span>
              <input type="number" min={15} value={productForm.durationMinutes} onChange={e => setProductForm(f => ({ ...f, durationMinutes: Number(e.target.value) }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-gray-500">Price</span>
              <input type="number" min={0} step="0.01" value={productForm.price} onChange={e => setProductForm(f => ({ ...f, price: Number(e.target.value) }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase text-gray-500">Stripe price ID</span>
              <input value={productForm.stripePriceId || ''} onChange={e => setProductForm(f => ({ ...f, stripePriceId: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" placeholder="price_..." />
            </label>
            <div className={`sm:col-span-2 rounded-2xl border p-3 ${
              productFormCheckoutReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-950/25 dark:text-emerald-100'
                : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/25 dark:text-amber-100'
            }`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-bold">
                    {productFormCheckoutReady ? 'Online checkout ready for this product' : 'Online checkout setup'}
                  </p>
                  <p className="mt-1 text-xs leading-5 opacity-85">
                    Manual vouchers can still be issued without Stripe. Public online purchase buttons only appear after Stripe is connected, the product is active, has a real AUD price, and has a connected-account Stripe Price ID.
                  </p>
                  {!productFormCheckoutReady && (
                    <ul className="mt-2 space-y-1 text-xs leading-5">
                      {productFormStripeIssues.map(issue => (
                        <li key={issue}>- {issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                  <button
                    type="button"
                    onClick={handleValidateStripePrice}
                    disabled={stripeValidationLoading || !stripeConnected || !productFormStripeId}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-gray-800 ring-1 ring-black/5 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#111827] dark:text-gray-100 dark:ring-white/10"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {stripeValidationLoading ? 'Checking...' : 'Check Stripe ID'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateStripePrice}
                    disabled={stripeCreationLoading || !stripeConnected || !editingProductId || Boolean(productFormStripeId) || productFormPrice <= 0}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#635bff] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#5147f0] disabled:cursor-not-allowed disabled:opacity-50"
                    title={!stripeConnected ? 'Connect Stripe in Settings > Integrations first' : !editingProductId ? 'Save this voucher product first' : undefined}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {stripeCreationLoading ? 'Connecting...' : 'Create & link Stripe'}
                  </button>
                  <button
                    type="button"
                    onClick={copyStripeSetupSummary}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-gray-800 ring-1 ring-black/5 transition hover:bg-white dark:bg-[#111827] dark:text-gray-100 dark:ring-white/10"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Stripe details
                  </button>
                  <a
                    href="https://dashboard.stripe.com/products"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-gray-800 ring-1 ring-black/5 transition hover:bg-white dark:bg-[#111827] dark:text-gray-100 dark:ring-white/10"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Stripe products
                  </a>
                </div>
              </div>
              {stripeValidation && (
                <div className={`mt-3 rounded-xl border p-3 text-xs leading-5 ${
                  stripeValidation.valid
                    ? 'border-emerald-200 bg-white/70 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950/20 dark:text-emerald-100'
                    : 'border-amber-200 bg-white/70 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/20 dark:text-amber-100'
                }`}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-bold">
                        {stripeValidation.valid ? 'Stripe price verified' : 'Stripe price needs attention'}
                      </p>
                      {stripeValidation.price && (
                        <p className="mt-1">
                          {stripeValidation.price.productName || stripeValidation.price.productId || 'Stripe product'} - {stripeValidation.price.currency} {stripeValidation.price.unitAmount?.toFixed(2) || 'variable'}
                          {stripeValidation.price.livemode ? ' (live mode)' : ' (test mode)'}
                        </p>
                      )}
                    </div>
                    {stripeValidation.price?.id && (
                      <span className="rounded-lg bg-white/70 px-2 py-1 font-mono text-[11px] dark:bg-[#111827]">
                        {stripeValidation.price.id}
                      </span>
                    )}
                  </div>
                  {stripeValidation.issues && stripeValidation.issues.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {stripeValidation.issues.map(issue => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <label className="sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-gray-500">Aircraft rule</span>
              <select value={productForm.aircraftMode} onChange={e => setProductForm(f => ({ ...f, aircraftMode: e.target.value as TrialFlightVoucherAircraftMode }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100">
                <option value="tecnam">Any Tecnam</option>
                <option value="archer">PA-28 Archer</option>
                <option value="specific">Selected aircraft only</option>
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-gray-500">Description</span>
              <textarea rows={3} value={productForm.description} onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-gray-500">Voucher email subject</span>
              <input
                value={productForm.emailSubject}
                onChange={e => setProductForm(f => ({ ...f, emailSubject: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100"
                placeholder="Your Bendigo Flying Club trial flight voucher"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-gray-500">Email body</span>
              <textarea rows={4} value={productForm.emailBody} onChange={e => setProductForm(f => ({ ...f, emailBody: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-gray-500">Booking instructions</span>
              <textarea rows={3} value={productForm.bookingInstructions} onChange={e => setProductForm(f => ({ ...f, bookingInstructions: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
            </label>
            <div className="sm:col-span-2 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-400/25 dark:bg-blue-950/25 dark:text-blue-100">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-200">Email preview</p>
                  <h3 className="mt-1 truncate text-base font-bold text-blue-950 dark:text-blue-50">
                    {productForm.emailSubject || 'Your Bendigo Flying Club trial flight voucher'}
                  </h3>
                </div>
                <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-800 ring-1 ring-blue-100 dark:bg-[#111827] dark:text-blue-100 dark:ring-blue-400/20">
                  {Number(productForm.durationMinutes || 0)} min flight + 30 min booking block
                </span>
              </div>
              <div className="mt-3 rounded-xl bg-white p-3 leading-6 text-gray-700 ring-1 ring-blue-100 dark:bg-[#111827] dark:text-gray-200 dark:ring-blue-400/20">
                <p className="font-semibold text-gray-950 dark:text-gray-100">{productForm.name || 'Trial instructional flight voucher'}</p>
                <p className="mt-2">{productForm.emailBody || defaultEmailBody}</p>
                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600 dark:bg-[#0b1120] dark:text-gray-300">
                  The delivered email includes the voucher code, a secure booking link, the flight duration, the booking block, and these instructions:
                  <span className="mt-1 block font-semibold text-gray-800 dark:text-gray-100">
                    {productForm.bookingInstructions || 'Use the voucher code or link to choose an available flight time.'}
                  </span>
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-200 sm:col-span-2">
              <input
                type="checkbox"
                checked={productForm.isActive}
                onChange={e => setProductForm(f => ({ ...f, isActive: e.target.checked }))}
              />
              Active and available to issue
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 p-3 dark:border-[#2c2f36]">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><Plane className="h-4 w-4" /> Specific aircraft</p>
              <div className="max-h-40 space-y-2 overflow-y-auto">
                {aircraft.map(item => (
                  <label key={item.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={productForm.aircraftIds.includes(item.id)} onChange={e => updateArraySelection('aircraftIds', item.id, e.target.checked)} />
                    {item.registration} {item.make} {item.model}
                  </label>
                ))}
              </div>
              <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                hasAircraftSetupWarning
                  ? 'border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100'
                  : 'bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:text-blue-100'
              }`}>
                {hasAircraftSetupWarning
                  ? 'This voucher will not show availability until at least one matching aircraft is available.'
                  : aircraftSetupText}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 dark:border-[#2c2f36]">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100"><Users className="h-4 w-4" /> Eligible instructors</p>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {instructors.map(instructor => {
                  const readiness = instructorVoucherReadiness(instructor.id);
                  return (
                    <label
                      key={instructor.id}
                      className={`block rounded-lg border px-3 py-2 text-sm transition ${
                        productForm.instructorIds.includes(instructor.id)
                          ? 'border-blue-200 bg-blue-50 dark:border-blue-400/30 dark:bg-blue-950/20'
                          : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-[#2c2f36] dark:bg-[#111827] dark:hover:bg-[#171a21]'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="flex min-w-0 items-start gap-2">
                          <input
                            type="checkbox"
                            checked={productForm.instructorIds.includes(instructor.id)}
                            onChange={e => updateArraySelection('instructorIds', instructor.id, e.target.checked)}
                            className="mt-1"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-gray-800 dark:text-gray-100">{instructor.name}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">{readiness.detail}</span>
                          </span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                          readiness.ready
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
                        }`}>
                          {readiness.label}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {instructors.length === 0 && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
                    Add instructors before this voucher can be issued or sold.
                  </p>
                )}
              </div>
              <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
                Voucher booking times only appear when at least one selected instructor can fly at least one serviceable eligible aircraft.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button onClick={handleSaveProduct} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:w-auto">
              <Save className="h-4 w-4" />
              {editingProductId ? 'Save product' : 'Create product'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowProductForm(false);
                setEditingProductId(undefined);
                setProductForm(emptyProduct());
                setStripeValidation(null);
              }}
              className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#20242b] sm:w-auto"
            >
              Cancel
            </button>
          </div>

          </>
          )}

          {false && (
          <div className="mt-6 border-t border-gray-200 pt-4 dark:border-[#2c2f36]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-gray-950 dark:text-gray-100">Existing voucher products</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Edit aircraft rules, instructors, email wording and whether the product can be issued.</p>
              </div>
            </div>
            <div className="space-y-2">
              {products.map(product => {
                const checkout = checkoutStatus(product);
                const booking = bookingReadiness(product);
                const productAircraft = getProductAircraft(product);
                const serviceableAircraftNames = productAircraft.serviceableAircraft.map(aircraftLabel);
                const instructorNames = productInstructorNames(product);
                const nextActions = productNextActions(product);
                return (
                  <div
                    key={product.id}
                    className={`rounded-xl border p-3 transition ${
                      editingProductId === product.id
                        ? 'border-blue-300 bg-blue-50 dark:border-blue-400/40 dark:bg-blue-950/20'
                        : 'border-gray-200 bg-white dark:border-[#2c2f36] dark:bg-[#111827]'
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-gray-950 dark:text-gray-100">{product.name || 'Untitled voucher'}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                            product.isActive
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                              : 'bg-gray-100 text-gray-600 dark:bg-[#20242b] dark:text-gray-300'
                          }`}>
                            {product.isActive ? 'Active' : 'Inactive'}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${checkout.className}`}>
                            {checkout.label}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                            booking.ready
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                              : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                          }`}>
                            {booking.ready ? 'Bookable' : 'No availability'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {modeLabel(product.aircraftMode)} - {product.durationMinutes} min flight, {product.durationMinutes + 30} min booking block - {formatMoney(product.price)}
                        </p>
                        {product.stripePriceId && (
                          <p className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400">
                            Stripe: {product.stripePriceId}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {booking.serviceableAircraftCount} of {booking.aircraftCount} eligible aircraft serviceable - {booking.qualifiedInstructorCount} qualified instructor{booking.qualifiedInstructorCount === 1 ? '' : 's'}
                          {product.aircraftIds.length > 0 ? ' - selected aircraft only' : ''}
                        </p>
                        <div className="mt-2 grid gap-2 text-xs leading-5 sm:grid-cols-2">
                          <p className="rounded-lg bg-gray-50 px-3 py-2 text-gray-600 dark:bg-[#171a21] dark:text-gray-300">
                            <span className="font-semibold text-gray-800 dark:text-gray-100">Aircraft:</span>{' '}
                            {compactList(serviceableAircraftNames, 'No serviceable aircraft detected')}
                          </p>
                          <p className="rounded-lg bg-gray-50 px-3 py-2 text-gray-600 dark:bg-[#171a21] dark:text-gray-300">
                            <span className="font-semibold text-gray-800 dark:text-gray-100">Instructors:</span>{' '}
                            {compactList(instructorNames, 'No instructors selected')}
                          </p>
                        </div>
                        {!booking.ready && (
                          <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800 dark:border-red-400/25 dark:bg-red-950/30 dark:text-red-100">
                            <p className="flex items-center gap-1.5 font-bold">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              This product will not show bookable voucher times yet.
                            </p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5">
                              {booking.issues.map(issue => (
                                <li key={issue}>{issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {nextActions.length > 0 && (
                          <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-400/25 dark:bg-amber-950/30 dark:text-amber-100">
                            <p className="font-bold">Setup actions</p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5">
                              {nextActions.map(action => (
                                <li key={action}>{action}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(product)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#20242b]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleProductActive(product)}
                          disabled={saving}
                          className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
                            product.isActive
                              ? 'border border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-400/30 dark:text-amber-200 dark:hover:bg-amber-950/30'
                              : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400/30 dark:text-emerald-200 dark:hover:bg-emerald-950/30'
                          }`}
                        >
                          {product.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {products.length === 0 && (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-[#363b45] dark:text-gray-400">
                  No voucher products yet. Create the Tecnam and Archer products here before issuing vouchers.
                </p>
              )}
            </div>
          </div>
          )}
        </section>
        )}

        {activeVoucherTab === 'issue' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
            <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Issue voucher</h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Create and email vouchers for cash sales, EFTs, or other external payments without using Stripe checkout.</p>
            <div className="grid gap-3">
              <select value={issueForm.productId} onChange={e => setIssueForm(f => ({ ...f, productId: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100">
                <option value="">Select voucher product</option>
                {activeProducts.map(product => {
                  const readiness = bookingReadiness(product);
                  return (
                    <option key={product.id} value={product.id} disabled={!readiness.ready}>
                      {product.name}{readiness.ready ? '' : ' - setup incomplete'}
                    </option>
                  );
                })}
              </select>
              {selectedProduct && (
                <div className={`rounded-lg border p-3 text-sm ${
                  selectedProductIsIssueable
                    ? 'border-blue-100 bg-blue-50 text-blue-900 dark:border-blue-400/25 dark:bg-blue-950/30 dark:text-blue-100'
                    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100'
                }`}>
                  <p>
                    {modeLabel(selectedProduct.aircraftMode)} - {selectedProduct.durationMinutes} min flight, {selectedProduct.durationMinutes + 30} min booking block.
                  </p>
                  <p className="mt-1 text-xs">
                    {selectedProductReadiness?.serviceableAircraftCount ?? 0} serviceable aircraft - {selectedProductReadiness?.qualifiedInstructorCount ?? 0} qualified instructor{selectedProductReadiness?.qualifiedInstructorCount === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 text-xs font-semibold">
                    Sale price: ${selectedProduct.price.toFixed(2)} AUD
                  </p>
                  {selectedProduct.stripePriceId && (
                    <span className="mt-1 block text-xs font-mono text-blue-700 dark:text-blue-200">Stripe price: {selectedProduct.stripePriceId}</span>
                  )}
                  {!selectedProductIsIssueable && selectedProductReadiness && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
                      {selectedProductReadiness.issues.map(issue => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Payment handling
                <select
                  value={issueForm.paymentStatus}
                  onChange={e => setIssueForm(f => ({ ...f, paymentStatus: e.target.value as TrialFlightVoucherPaymentStatus }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100"
                >
                  <option value="paid">Paid outside CRM (cash / EFT / other)</option>
                  <option value="manual">Manual issue without marking paid</option>
                  <option value="pending">Save as unpaid draft</option>
                  <option value="waived">Complimentary / waived</option>
                </select>
              </label>
              {issueForm.paymentStatus === 'paid' && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950/30 dark:text-emerald-100">
                  This marks the voucher as paid now and sends the voucher email immediately, or schedules it if a future recipient send time is set.
                </div>
              )}
              {issueForm.paymentStatus === 'manual' && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900 dark:border-blue-400/30 dark:bg-blue-950/30 dark:text-blue-100">
                  Use this when you need to send the voucher now but do not want to record it as paid inside the CRM.
                </div>
              )}
              {issueForm.paymentStatus === 'pending' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
                  Payment pending saves this voucher as a draft. It will not email or redeem until it is marked paid, manual, or waived.
                </div>
              )}
              {issueForm.paymentStatus === 'waived' && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-900 dark:border-violet-400/30 dark:bg-violet-950/30 dark:text-violet-100">
                  Complimentary vouchers are issued and emailed without recording a payment.
                </div>
              )}
              <input value={issueForm.purchaserName} onChange={e => setIssueForm(f => ({ ...f, purchaserName: e.target.value }))} placeholder="Purchaser name" className="rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
              <input type="email" value={issueForm.purchaserEmail} onChange={e => setIssueForm(f => ({ ...f, purchaserEmail: e.target.value }))} placeholder="Purchaser email" className="rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
              <input value={issueForm.purchaserPhone} onChange={e => setIssueForm(f => ({ ...f, purchaserPhone: e.target.value }))} placeholder="Purchaser phone" className="rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input type="checkbox" checked={issueForm.sendToRecipient} onChange={e => setIssueForm(f => ({ ...f, sendToRecipient: e.target.checked }))} />
                Send direct to recipient
              </label>
              {issueForm.sendToRecipient ? (
                <div className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-400/20 dark:bg-blue-950/20">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-200">
                    Recipient delivery
                  </p>
                  <input value={issueForm.recipientName} onChange={e => setIssueForm(f => ({ ...f, recipientName: e.target.value }))} placeholder="Recipient name" className="rounded-lg border border-blue-200 bg-white px-3 py-2 dark:border-blue-400/30 dark:bg-[#111827] dark:text-gray-100" />
                  <input type="email" value={issueForm.recipientEmail} onChange={e => setIssueForm(f => ({ ...f, recipientEmail: e.target.value }))} placeholder="Recipient email" className="rounded-lg border border-blue-200 bg-white px-3 py-2 dark:border-blue-400/30 dark:bg-[#111827] dark:text-gray-100" />
                  <label className="text-sm text-blue-800 dark:text-blue-100">
                    Scheduled send date/time
                    <input type="datetime-local" min={minimumRecipientDeliveryAt} value={issueForm.recipientDeliveryAt} onChange={e => setIssueForm(f => ({ ...f, recipientDeliveryAt: e.target.value }))} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 dark:border-blue-400/30 dark:bg-[#111827] dark:text-gray-100" />
                  </label>
                  <p className="text-xs leading-5 text-blue-700 dark:text-blue-200">
                    Leave the schedule blank to email the recipient immediately.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-300">
                  The voucher email will be sent to the purchaser so they can forward or print it when they are ready.
                </div>
              )}
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Expiry date
                <input type="date" value={issueForm.expiresAt} onChange={e => setIssueForm(f => ({ ...f, expiresAt: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
              </label>
              <textarea value={issueForm.notes} onChange={e => setIssueForm(f => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Internal notes" className="rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
              <div className="grid gap-2 sm:grid-cols-2">
                <button onClick={() => handleIssueVoucher(issueForm.paymentStatus)} disabled={saving || loading || (Boolean(selectedProduct) && !selectedProductIsIssueable)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                  <Mail className="h-4 w-4" />
                  {resolveIssueButtonLabel(issueForm.paymentStatus)}
                </button>
                <button
                  onClick={() => handleIssueVoucher('paid')}
                  disabled={saving || loading || !issueForm.productId || (Boolean(selectedProduct) && !selectedProductIsIssueable)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-400/30 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-950/50"
                  type="button"
                >
                  <CheckCircle className="h-4 w-4" />
                  Mark paid now
                </button>
              </div>
            </div>
          </div>
        )}

        {activeVoucherTab === 'recent' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Recent vouchers</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Search vouchers, check their status and resend voucher emails.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    dueRecipientVouchers.length > 0
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
                  }`}>
                    {dueRecipientVouchers.length} due now
                  </span>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
                    {futureRecipientVouchers.length} scheduled
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleProcessDueEmails}
                disabled={saving}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:opacity-60 dark:border-blue-400/30 dark:bg-blue-950/30 dark:text-blue-200 dark:hover:bg-blue-950/50"
              >
                <Mail className="h-3.5 w-3.5" />
                {dueRecipientVouchers.length > 0 ? `Send due now (${dueRecipientVouchers.length})` : 'Check due emails'}
              </button>
            </div>
            <label className="mb-3 block">
              <span className="sr-only">Search vouchers</span>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-[#2c2f36] dark:bg-[#111827]">
                <Search className="h-4 w-4 shrink-0 text-gray-400" />
                <input
                  value={voucherSearch}
                  onChange={event => setVoucherSearch(event.target.value)}
                  placeholder="Search by code, purchaser, recipient, status or Stripe session..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
                />
                {voucherSearch && (
                  <button
                    type="button"
                    onClick={() => setVoucherSearch('')}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#20242b]"
                  >
                    Clear
                  </button>
                )}
              </div>
            </label>
            {dueRecipientVouchers.length > 0 && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
                {dueRecipientVouchers.length} scheduled recipient email{dueRecipientVouchers.length === 1 ? ' is' : 's are'} due and not marked delivered. The cards needing attention are shown first.
              </div>
            )}
            <div className="space-y-2">
              {visibleRecentVouchers.map(voucher => {
                const redeemUrl = getRedeemUrl(voucher.code);
                const delivery = voucherDeliveryDetails(voucher);
                const canCancelVoucher = voucher.status !== 'cancelled' && voucher.status !== 'booked' && !voucher.bookedBookingId;
                return (
                <div key={voucher.id} className={`rounded-xl border p-3 ${
                  delivery.state === 'due'
                    ? 'border-amber-300 bg-amber-50/70 dark:border-amber-400/35 dark:bg-amber-950/20'
                    : 'border-gray-200 dark:border-[#2c2f36]'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-950 dark:text-gray-100">{voucher.productName || 'Voucher'}</p>
                      <p className="text-sm text-gray-500">{voucher.purchaserName} - {voucher.purchaserEmail}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">{voucher.status}</span>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${paymentPillClass(voucher.paymentStatus)}`}>
                        {paymentLabel(voucher.paymentStatus)}
                      </span>
                    </div>
                  </div>
                  <div className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${
                    delivery.state === 'due'
                      ? 'border-amber-200 bg-amber-100 text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100'
                      : 'border-blue-100 bg-blue-50 text-blue-900 dark:border-blue-400/20 dark:bg-blue-950/20 dark:text-blue-100'
                  }`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-bold uppercase tracking-wide">{delivery.label}</p>
                        <p className="mt-0.5 truncate">
                          {delivery.name} - {delivery.email}
                        </p>
                      </div>
                      <p className={`max-w-xs sm:text-right ${
                        delivery.state === 'due'
                          ? 'font-semibold text-amber-900 dark:text-amber-100'
                          : 'text-blue-800 dark:text-blue-200'
                      }`}>
                        {delivery.schedule}
                      </p>
                    </div>
                  </div>
                  {(voucher.redeemedByName || voucher.bookedBooking) && (
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      {voucher.redeemedByName && (
                        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 leading-5 text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-950/20 dark:text-emerald-100">
                          <p className="font-bold uppercase tracking-wide">Redeemed account</p>
                          <p className="mt-0.5 truncate">{voucher.redeemedByName}</p>
                          {voucher.redeemedByEmail && (
                            <p className="truncate text-emerald-700 dark:text-emerald-200">{voucher.redeemedByEmail}</p>
                          )}
                          {voucher.redeemedAt && (
                            <p className="mt-1 text-emerald-700 dark:text-emerald-200">Redeemed {voucher.redeemedAt.toLocaleString()}</p>
                          )}
                          {voucher.status === 'redeemed' && (
                            <button
                              type="button"
                              onClick={() => handleResendSetupLink(voucher)}
                              disabled={saving}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-400/30 dark:bg-[#111827] dark:text-emerald-200 dark:hover:bg-emerald-950/40"
                            >
                              <Mail className="h-3.5 w-3.5" />
                              Resend setup link
                            </button>
                          )}
                        </div>
                      )}
                      {voucher.bookedBooking && (
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 leading-5 text-indigo-950 dark:border-indigo-400/20 dark:bg-indigo-950/20 dark:text-indigo-100">
                          <p className="font-bold uppercase tracking-wide">Linked booking</p>
                          <p className="mt-0.5 flex items-center gap-1.5 font-semibold">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {voucher.bookedBooking.startTime.toLocaleString([], {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </p>
                          <p className="truncate text-indigo-800 dark:text-indigo-200">
                            {voucher.bookedBooking.aircraftRegistration || 'Aircraft'}{voucher.bookedBooking.aircraftType ? ` - ${voucher.bookedBooking.aircraftType}` : ''}
                          </p>
                          <p className="truncate text-indigo-800 dark:text-indigo-200">
                            Instructor: {voucher.bookedBooking.instructorName || 'Not assigned'}
                          </p>
                          {voucher.bookedBooking.flightLogged ? (
                            <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                              Flight logged - release disabled
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleReleaseVoucherBooking(voucher)}
                              disabled={saving}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-400/30 dark:bg-[#111827] dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                            >
                              Release booking
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-[#2c2f36] dark:bg-[#111827]">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-mono text-gray-800 dark:text-gray-200">
                        <Ticket className="h-4 w-4 shrink-0" />
                        <span className="truncate">{voucher.code}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(voucher.code, 'Voucher code')}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-200 dark:hover:bg-[#20242b]"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy code
                      </button>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-[#2c2f36]">
                      <p className="break-all text-xs leading-5 text-gray-600 dark:text-gray-300">{redeemUrl}</p>
                      {voucher.stripeCheckoutSessionId && (
                        <div className="flex flex-col gap-2 rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-xs leading-5 text-purple-900 dark:border-purple-400/25 dark:bg-purple-950/25 dark:text-purple-100 sm:flex-row sm:items-center sm:justify-between">
                          <span className="min-w-0">
                            <span className="font-bold uppercase tracking-wide">Stripe checkout</span>
                            <span className="ml-2 break-all font-mono">{voucher.stripeCheckoutSessionId}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(voucher.stripeCheckoutSessionId || '', 'Stripe checkout session ID')}
                            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-purple-700 transition hover:bg-purple-100 dark:border-purple-400/30 dark:bg-[#171a21] dark:text-purple-200 dark:hover:bg-purple-950/40"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy session
                          </button>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(redeemUrl, 'Redeem link')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-200 dark:hover:bg-[#20242b]"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy link
                        </button>
                        <a
                          href={redeemUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 dark:border-blue-400/30 dark:bg-[#171a21] dark:text-blue-200 dark:hover:bg-blue-950/40"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </a>
                        <button
                          type="button"
                          onClick={() => downloadVoucherCertificate(voucher)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-400/30 dark:bg-[#171a21] dark:text-emerald-200 dark:hover:bg-emerald-950/40"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download voucher
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                    delivery.state === 'due'
                      ? 'bg-amber-100 font-semibold text-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
                      : 'bg-gray-50 text-gray-600 dark:bg-[#111827] dark:text-gray-300'
                  }`}>
                    {voucher.deliveredAt
                      ? `Email delivered ${voucher.deliveredAt.toLocaleString()}`
                      : voucher.sendToRecipient && voucher.recipientDeliveryAt
                        ? `${delivery.state === 'due' ? 'Recipient email is due now' : 'Recipient email scheduled'} for ${voucher.recipientDeliveryAt.toLocaleString()}`
                        : 'Purchaser email not marked delivered yet'}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(voucher.status === 'draft' || voucher.paymentStatus === 'pending') && (
                      <button
                        type="button"
                        onClick={() => handleMarkVoucherReady(voucher.id)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Mark paid & send
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSendVoucherEmail(voucher.id, false)}
                      disabled={saving || voucher.status === 'draft' || voucher.paymentStatus === 'pending'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-[#2c2f36] dark:text-gray-200 dark:hover:bg-[#111827]"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {voucher.deliveredAt ? 'Resend' : 'Send email'}
                    </button>
                    {voucher.sendToRecipient && voucher.recipientDeliveryAt && !voucher.deliveredAt && voucher.recipientDeliveryAt > new Date() && (
                      <button
                        type="button"
                        onClick={() => handleSendVoucherEmail(voucher.id, true)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        Send now
                      </button>
                    )}
                    {canCancelVoucher && (
                      <button
                        type="button"
                        onClick={() => handleCancelVoucher(voucher)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:bg-[#171a21] dark:text-red-200 dark:hover:bg-red-950/30"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancel voucher
                      </button>
                    )}
                  </div>
                </div>
              );
              })}
              {vouchers.length === 0 && <p className="text-sm text-gray-500">No vouchers issued yet.</p>}
              {vouchers.length > 0 && visibleRecentVouchers.length === 0 && (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-[#363b45] dark:text-gray-400">
                  No vouchers match that search.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrialFlightVouchersPage;
