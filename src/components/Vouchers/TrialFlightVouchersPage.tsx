import React, { useMemo, useState } from 'react';
import { Copy, ExternalLink, Mail, Pencil, Plane, Plus, Save, Ticket, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAircraft } from '../../hooks/useAircraft';
import { useTrialFlightVouchers } from '../../hooks/useTrialFlightVouchers';
import { useUsers } from '../../hooks/useUsers';
import { TrialFlightVoucherAircraftMode, TrialFlightVoucherProduct } from '../../types';
import toast from 'react-hot-toast';

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

export const TrialFlightVouchersPage: React.FC = () => {
  const { user } = useAuth();
  const { aircraft } = useAircraft();
  const { users, getInstructors } = useUsers();
  const { products, vouchers, loading, saveProduct, issueVoucher, sendVoucherEmail } = useTrialFlightVouchers();
  const [productForm, setProductForm] = useState(emptyProduct);
  const [editingProductId, setEditingProductId] = useState<string | undefined>();
  const [issueForm, setIssueForm] = useState({
    productId: '',
    purchaserName: '',
    purchaserEmail: '',
    purchaserPhone: '',
    recipientName: '',
    recipientEmail: '',
    sendToRecipient: false,
    recipientDeliveryAt: '',
    expiresAt: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const instructors = getInstructors();
  const activeProducts = products.filter(product => product.isActive);
  const selectedProduct = products.find(product => product.id === issueForm.productId);

  const aircraftByMode = useMemo(() => {
    const tecnams = aircraft.filter(item =>
      `${item.make} ${item.model} ${item.registration}`.toLowerCase().includes('tecnam')
    );
    const archers = aircraft.filter(item =>
      `${item.make} ${item.model} ${item.registration}`.toLowerCase().includes('archer')
      || `${item.make} ${item.model}`.toLowerCase().includes('pa-28')
    );
    return { tecnams, archers };
  }, [aircraft]);

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
    setProductForm({
      name: product.name,
      description: product.description,
      aircraftMode: product.aircraftMode,
      aircraftIds: product.aircraftIds,
      instructorIds: product.instructorIds,
      durationMinutes: product.durationMinutes,
      price: product.price,
      emailSubject: product.emailSubject,
      emailBody: product.emailBody,
      bookingInstructions: product.bookingInstructions,
      isActive: product.isActive,
    });
  };

  const applyPreset = (aircraftMode: TrialFlightVoucherAircraftMode) => {
    setEditingProductId(undefined);
    setProductForm(buildPresetProduct(aircraftMode, instructors.map(instructor => instructor.id)));
    toast.success(`${modeLabel(aircraftMode)} voucher template loaded`);
  };

  const handleToggleProductActive = async (product: TrialFlightVoucherProduct) => {
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

    setSaving(true);
    try {
      await saveProduct(productForm, editingProductId);
      setProductForm(emptyProduct());
      setEditingProductId(undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleIssueVoucher = async () => {
    if (!issueForm.productId || !issueForm.purchaserName || !issueForm.purchaserEmail) {
      toast.error('Select a voucher and enter purchaser name/email');
      return;
    }
    if (issueForm.sendToRecipient && !issueForm.recipientEmail) {
      toast.error('Recipient email is required when sending direct to recipient');
      return;
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
        notes: issueForm.notes,
        createdBy: user?.id,
      });
      setIssueForm({
        productId: '',
        purchaserName: '',
        purchaserEmail: '',
        purchaserPhone: '',
        recipientName: '',
        recipientEmail: '',
        sendToRecipient: false,
        recipientDeliveryAt: '',
        expiresAt: '',
        notes: '',
      });
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

  const getRedeemUrl = (code: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/trial-flight-voucher?code=${encodeURIComponent(code)}`;
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

  const modeLabel = (mode: TrialFlightVoucherAircraftMode) =>
    mode === 'tecnam' ? 'Any Tecnam' : mode === 'archer' ? 'PA-28 Archer' : 'Selected aircraft';

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
        ? `Matching ${modeLabel(productForm.aircraftMode).toLowerCase()} aircraft plus ${productForm.aircraftIds.length} selected aircraft can be offered.`
        : `${matchingAircraftCount} ${modeLabel(productForm.aircraftMode).toLowerCase()} aircraft currently match this voucher rule.`;

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-950 to-blue-800 p-5 text-white shadow-lg sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Trial instructional flights</p>
            <h1 className="mt-2 text-2xl font-bold">Gift Vouchers</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">
              Create Tecnam or Archer trial flight vouchers, choose eligible aircraft and instructors, then issue a code for the purchaser or recipient to redeem.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <p className="text-lg font-bold">{products.length}</p>
              <p className="text-xs text-blue-100">Products</p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <p className="text-lg font-bold">{vouchers.length}</p>
              <p className="text-xs text-blue-100">Issued</p>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <p className="text-lg font-bold">{vouchers.filter(voucher => voucher.status === 'redeemed').length}</p>
              <p className="text-xs text-blue-100">Redeemed</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Voucher products</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Define what can be sold before Stripe is connected.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingProductId(undefined);
                setProductForm(emptyProduct());
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#2c2f36] dark:text-gray-200 dark:hover:bg-[#111827]"
            >
              <Plus className="h-4 w-4" />
              New
            </button>
          </div>

          <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-400/20 dark:bg-blue-950/20">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-bold text-blue-950 dark:text-blue-100">Quick setup templates</p>
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  Load a standard voucher, then confirm price, aircraft and eligible instructors before saving.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[24rem]">
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
              <span className="text-xs font-semibold uppercase text-gray-500">Email body</span>
              <textarea rows={4} value={productForm.emailBody} onChange={e => setProductForm(f => ({ ...f, emailBody: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
            </label>
            <label className="sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-gray-500">Booking instructions</span>
              <textarea rows={3} value={productForm.bookingInstructions} onChange={e => setProductForm(f => ({ ...f, bookingInstructions: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100" />
            </label>
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
              <div className="max-h-40 space-y-2 overflow-y-auto">
                {instructors.map(instructor => (
                  <label key={instructor.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={productForm.instructorIds.includes(instructor.id)} onChange={e => updateArraySelection('instructorIds', instructor.id, e.target.checked)} />
                    {instructor.name}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <button onClick={handleSaveProduct} disabled={saving} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:w-auto">
            <Save className="h-4 w-4" />
            {editingProductId ? 'Save product' : 'Create product'}
          </button>

          <div className="mt-6 border-t border-gray-200 pt-4 dark:border-[#2c2f36]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-gray-950 dark:text-gray-100">Existing voucher products</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Edit aircraft rules, instructors, email wording and whether the product can be issued.</p>
              </div>
            </div>
            <div className="space-y-2">
              {products.map(product => (
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
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {modeLabel(product.aircraftMode)} - {product.durationMinutes} min flight, {product.durationMinutes + 30} min booking block - ${product.price.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {product.instructorIds.length} eligible instructor{product.instructorIds.length === 1 ? '' : 's'}
                        {product.aircraftIds.length > 0 ? ` - ${product.aircraftIds.length} selected aircraft` : ''}
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
              ))}
              {products.length === 0 && (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-[#363b45] dark:text-gray-400">
                  No voucher products yet. Create the Tecnam and Archer products here before issuing vouchers.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
            <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Issue voucher</h2>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Creates the code now. Stripe payment can later create the same record automatically.</p>
            <div className="grid gap-3">
              <select value={issueForm.productId} onChange={e => setIssueForm(f => ({ ...f, productId: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-100">
                <option value="">Select voucher product</option>
                {activeProducts.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
              {selectedProduct && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                  {modeLabel(selectedProduct.aircraftMode)} - {selectedProduct.durationMinutes} min flight, {selectedProduct.durationMinutes + 30} min booking block.
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
                    <input type="datetime-local" value={issueForm.recipientDeliveryAt} onChange={e => setIssueForm(f => ({ ...f, recipientDeliveryAt: e.target.value }))} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 dark:border-blue-400/30 dark:bg-[#111827] dark:text-gray-100" />
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
              <button onClick={handleIssueVoucher} disabled={saving || loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                <Mail className="h-4 w-4" />
                Issue voucher
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
            <h2 className="mb-3 text-lg font-bold text-gray-950 dark:text-gray-100">Recent vouchers</h2>
            <div className="space-y-2">
              {vouchers.slice(0, 8).map(voucher => {
                const redeemUrl = getRedeemUrl(voucher.code);
                return (
                <div key={voucher.id} className="rounded-xl border border-gray-200 p-3 dark:border-[#2c2f36]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-950 dark:text-gray-100">{voucher.productName || 'Voucher'}</p>
                      <p className="text-sm text-gray-500">{voucher.purchaserName} - {voucher.purchaserEmail}</p>
                    </div>
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">{voucher.status}</span>
                  </div>
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
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-[#111827] dark:text-gray-300">
                    {voucher.deliveredAt
                      ? `Email delivered ${voucher.deliveredAt.toLocaleString()}`
                      : voucher.sendToRecipient && voucher.recipientDeliveryAt
                        ? `Recipient email scheduled for ${voucher.recipientDeliveryAt.toLocaleString()}`
                        : 'Purchaser email not marked delivered yet'}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleSendVoucherEmail(voucher.id, false)}
                      disabled={saving}
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
                  </div>
                </div>
              );
              })}
              {vouchers.length === 0 && <p className="text-sm text-gray-500">No vouchers issued yet.</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default TrialFlightVouchersPage;
