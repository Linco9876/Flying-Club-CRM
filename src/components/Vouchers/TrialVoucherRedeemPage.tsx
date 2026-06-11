import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle, ChevronLeft, ChevronRight, Copy, Gift, Loader2, Plane, Ticket } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

interface PublicVoucher {
  code: string;
  status: string;
  recipientName?: string;
  recipientEmail?: string;
  product: {
    name: string;
    description: string;
    aircraftMode: string;
    durationMinutes: number;
    bookingBlockMinutes: number;
    bookingInstructions: string;
  };
}

interface VoucherSlot {
  bookingId?: string;
  startTime: string;
  endTime: string;
  aircraftId: string;
  aircraftLabel: string;
  instructorId: string;
  instructorName: string;
}

const VOUCHER_TIME_ZONE = 'Australia/Sydney';
const CALENDAR_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const getInitialCode = () => {
  const params = new URLSearchParams(window.location.search);
  return (params.get('voucherCode') || params.get('code') || '').trim().toUpperCase();
};

export const TrialVoucherRedeemPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [code, setCode] = useState(getInitialCode);
  const [voucher, setVoucher] = useState<PublicVoucher | null>(null);
  const [loading, setLoading] = useState(false);
  const [redeemed, setRedeemed] = useState<{ setupLink?: string | null; setupEmailSent?: boolean } | null>(null);
  const [slots, setSlots] = useState<VoucherSlot[]>([]);
  const [bookedSlot, setBookedSlot] = useState<VoucherSlot | null>(null);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [confirmationEmailSent, setConfirmationEmailSent] = useState(false);
  const [setupResendEmail, setSetupResendEmail] = useState('');
  const [selectedSlotDate, setSelectedSlotDate] = useState('all');
  const [availabilityAutoLoadedForCode, setAvailabilityAutoLoadedForCode] = useState('');
  const isVoucherAccountUser = Boolean(user?.portalAccessScope === 'trial_voucher');
  const isFullPortalUserOnVoucherPage = Boolean(user && !isVoucherAccountUser);

  const loadLinkedVoucher = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: { action: 'my-voucher' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setVoucher(data.voucher);
      setCode(data.voucher?.code || '');
      setRedeemed({ setupLink: null, setupEmailSent: false });
      setSlots(data.slots || []);
      setBookedSlot(data.booking || null);
    } catch (error) {
      if (!code) setVoucher(null);
      toast.error(error instanceof Error ? error.message : 'Could not load your voucher');
    } finally {
      setLoading(false);
    }
  };

  const verifyVoucher = async (nextCode = code) => {
    if (!nextCode.trim()) {
      toast.error('Enter your voucher code');
      return;
    }
    setLoading(true);
    setRedeemed(null);
    try {
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: { action: 'verify', code: nextCode },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setVoucher(data.voucher);
      setCode(data.voucher?.code || nextCode);
      setForm(current => ({
        ...current,
        fullName: current.fullName || data.voucher?.recipientName || '',
        email: current.email || data.voucher?.recipientEmail || '',
      }));
    } catch (error) {
      setVoucher(null);
      toast.error(error instanceof Error ? error.message : 'Could not verify voucher');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (code) void verifyVoucher(code);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (code || !isVoucherAccountUser) return;
    void loadLinkedVoucher();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isVoucherAccountUser]);

  useEffect(() => {
    if (!isVoucherAccountUser || !code || bookedSlot) return;
    void loadLinkedVoucher();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoucherAccountUser, code, bookedSlot]);

  const redeemVoucher = async () => {
    if (!voucher) return;
    if (!form.fullName || !form.email || !form.phone) {
      toast.error('Full name, email and phone are required');
      return;
    }
    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/trial-flight-voucher?voucherCode=${encodeURIComponent(code)}`;
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: { action: 'redeem', code, ...form, redirectTo },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRedeemed({ setupLink: data.setupLink, setupEmailSent: Boolean(data.setupEmailSent) });
      setVoucher(data.voucher || (voucher ? { ...voucher, status: 'redeemed' } : voucher));
      toast.success('Voucher linked to your account');
      if (isVoucherAccountUser) await loadAvailability();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not redeem voucher');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailability = async (nextCode = code) => {
    if (!nextCode.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: { action: 'availability', code: nextCode },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSlots(data.slots || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load available times');
    } finally {
      setLoading(false);
    }
  };

  const bookSlot = async (slot: VoucherSlot) => {
    if (!user) {
      toast.error('Sign in to your voucher account before booking a time');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: {
          action: 'book',
          code,
          startTime: slot.startTime,
          aircraftId: slot.aircraftId,
          instructorId: slot.instructorId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setBookedSlot(data.booking || slot);
      setConfirmationEmailSent(Boolean(data.confirmationEmailSent));
      setVoucher(current => current ? { ...current, status: 'booked' } : current);
      setSlots([]);
      toast.success(data.confirmationEmailSent ? 'Trial flight booked and confirmation emailed' : 'Trial flight booked');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not book this time');
      await loadAvailability();
    } finally {
      setLoading(false);
    }
  };

  const resendSetupLink = async () => {
    if (!voucher || !code) return;
    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/trial-flight-voucher?voucherCode=${encodeURIComponent(code)}`;
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: { action: 'resend-setup', code, redirectTo },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRedeemed({ setupLink: data.setupLink, setupEmailSent: Boolean(data.setupEmailSent) });
      setSetupResendEmail(data.email || '');
      toast.success(data.setupEmailSent ? 'Setup link resent' : 'Setup link generated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resend setup link');
    } finally {
      setLoading(false);
    }
  };

  const formatSlotDate = (value: string) =>
    new Intl.DateTimeFormat('en-AU', {
      timeZone: VOUCHER_TIME_ZONE,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(value));

  const formatSlotTime = (start: string, end: string) => {
    const formatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: VOUCHER_TIME_ZONE,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`;
  };
  const flightDurationLabel = voucher?.product.durationMinutes
    ? `${voucher.product.durationMinutes} min trial flight`
    : 'Trial flight';
  const bookingBlockLabel = voucher?.product.bookingBlockMinutes
    ? `${voucher.product.bookingBlockMinutes} min reserved block`
    : 'Reserved booking block';

  const formatSlotDateHeading = (value: string) =>
    new Intl.DateTimeFormat('en-AU', {
      timeZone: VOUCHER_TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(value));

  const groupedSlots = useMemo(() => {
    const groups = new Map<string, VoucherSlot[]>();
    [...slots]
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .forEach(slot => {
        const key = new Intl.DateTimeFormat('en-CA', {
          timeZone: VOUCHER_TIME_ZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(slot.startTime));
        groups.set(key, [...(groups.get(key) || []), slot]);
      });

    return Array.from(groups.entries()).map(([dateKey, items]) => ({
      dateKey,
      label: formatSlotDateHeading(items[0].startTime),
      slots: items,
    }));
  }, [slots]);

  const groupedSlotMap = useMemo(
    () => new Map(groupedSlots.map(group => [group.dateKey, group])),
    [groupedSlots]
  );

  const availableMonthKeys = useMemo(
    () => Array.from(new Set(groupedSlots.map(group => group.dateKey.slice(0, 7)))),
    [groupedSlots]
  );

  const [calendarMonthKey, setCalendarMonthKey] = useState('');

  useEffect(() => {
    if (!groupedSlots.length) {
      setCalendarMonthKey('');
      return;
    }
    setCalendarMonthKey(current => {
      if (current && availableMonthKeys.includes(current)) return current;
      return groupedSlots[0].dateKey.slice(0, 7);
    });
  }, [availableMonthKeys, groupedSlots]);

  const calendarMonth = useMemo(() => {
    if (!calendarMonthKey) return null;
    const [year, month] = calendarMonthKey.split('-').map(Number);
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const leadingDays = (monthStart.getUTCDay() + 6) % 7;
    const totalCells = Math.ceil((leadingDays + monthEnd.getUTCDate()) / 7) * 7;
    const monthLabel = new Intl.DateTimeFormat('en-AU', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(monthStart);
    const days = Array.from({ length: totalCells }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, 1 - leadingDays + index));
      const dateKey = date.toISOString().slice(0, 10);
      const group = groupedSlotMap.get(dateKey);
      return {
        dateKey,
        dayNumber: date.getUTCDate(),
        isCurrentMonth: date.getUTCMonth() === month - 1,
        slotsCount: group?.slots.length || 0,
      };
    });
    return { label: monthLabel, days };
  }, [calendarMonthKey, groupedSlotMap]);

  const currentMonthIndex = calendarMonthKey ? availableMonthKeys.indexOf(calendarMonthKey) : -1;

  const showPreviousCalendarMonth = () => {
    if (currentMonthIndex <= 0) return;
    setCalendarMonthKey(availableMonthKeys[currentMonthIndex - 1]);
  };

  const showNextCalendarMonth = () => {
    if (currentMonthIndex < 0 || currentMonthIndex >= availableMonthKeys.length - 1) return;
    setCalendarMonthKey(availableMonthKeys[currentMonthIndex + 1]);
  };

  useEffect(() => {
    if (selectedSlotDate === 'all') return;
    if (!groupedSlots.some(group => group.dateKey === selectedSlotDate)) {
      setSelectedSlotDate('all');
    }
  }, [groupedSlots, selectedSlotDate]);

  const visibleSlotGroups = useMemo(
    () => selectedSlotDate === 'all'
      ? groupedSlots
      : groupedSlots.filter(group => group.dateKey === selectedSlotDate),
    [groupedSlots, selectedSlotDate]
  );

  const canChooseTime = Boolean(isVoucherAccountUser && voucher?.status === 'redeemed' && !bookedSlot);

  useEffect(() => {
    if (!canChooseTime || !code || slots.length > 0 || availabilityAutoLoadedForCode === code) return;
    setAvailabilityAutoLoadedForCode(code);
    void loadAvailability(code);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityAutoLoadedForCode, canChooseTime, code, slots.length]);

  const copySetupLink = async () => {
    if (!redeemed?.setupLink) return;
    try {
      await navigator.clipboard.writeText(redeemed.setupLink);
      toast.success('Setup link copied');
    } catch {
      toast.error('Could not copy setup link');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500">
              <Plane className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-200">Bendigo Flying Club</p>
              <h1 className="text-2xl font-bold">Trial Flight Voucher</h1>
            </div>
          </div>
          {user && (
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3 text-sm text-blue-50 sm:text-right">
              <p className="font-semibold">{user.name || user.email}</p>
              <p className="mt-0.5 text-xs text-blue-100/80">{user.email}</p>
              {isFullPortalUserOnVoucherPage && (
                <p className="mt-1 text-xs font-semibold text-amber-100">Normal portal account</p>
              )}
              <button
                type="button"
                onClick={logout}
                className="mt-2 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
              >
                Sign out
              </button>
            </div>
          )}
        </header>

        <main className="grid flex-1 items-start gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-3xl bg-gradient-to-br from-blue-900 to-slate-900 p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
            <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
              <Gift className="h-7 w-7 text-blue-100" />
            </div>
            <h2 className="text-3xl font-bold">Redeem your trial instructional flight</h2>
            <p className="mt-4 leading-7 text-blue-100">
              Enter the code from your voucher email. Once verified, we only need your full name, email and phone to create your restricted booking account.
            </p>
            <div className="mt-6 rounded-2xl bg-white/10 p-4 text-sm text-blue-50">
              Voucher bookings reserve the flight time plus 30 minutes for arrival, briefing and paperwork. Available times are based on aircraft and qualified instructor availability.
            </div>
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-blue-50">
              This account is only for choosing the trial flight time. If your email is already used for a normal club member account, use a different email for the voucher or contact the club to link it manually.
            </div>
          </section>

          <section className="rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={code}
                onChange={event => setCode(event.target.value.toUpperCase())}
                placeholder="BFC-XXXX-XXXX-XXXX"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 font-mono text-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => verifyVoucher()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                Verify
              </button>
            </div>

            {voucher && (
              <div className="mt-6 space-y-5">
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <div>
                      <h3 className="font-bold text-slate-950">{voucher.product.name}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{voucher.product.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">Flight</p>
                      <p className="font-bold">{voucher.product.durationMinutes} min</p>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">Booking block</p>
                      <p className="font-bold">{voucher.product.bookingBlockMinutes} min</p>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">Aircraft</p>
                      <p className="font-bold">{voucher.product.aircraftMode === 'tecnam' ? 'Any Tecnam' : voucher.product.aircraftMode === 'archer' ? 'PA-28 Archer' : 'Selected'}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-700">{voucher.product.bookingInstructions}</p>
                </div>

                {!redeemed && voucher.status === 'issued' ? (
                  <div className="grid gap-3">
                    <input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Full name" className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={redeemVoucher} disabled={loading} className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                      Create booking account
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                    <h3 className="font-bold">Your voucher is linked.</h3>
                    <p className="mt-1 text-sm">
                      {user
                        ? isFullPortalUserOnVoucherPage
                          ? 'This voucher is linked, but booking must be completed from the restricted voucher account. Sign out, then use the setup link from the voucher email.'
                          : 'Choose an available time below. Your booking block includes the flight plus 30 minutes for briefing and paperwork.'
                        : redeemed?.setupEmailSent
                          ? 'We have emailed your setup link. Set your password and sign in to your restricted voucher account before choosing a flight time.'
                          : 'Set your password and sign in to your restricted voucher account before choosing a flight time.'}
                    </p>
                    {redeemed?.setupLink && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <a href={redeemed.setupLink} className="inline-flex justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                          Set password / continue
                        </a>
                        <button
                          type="button"
                          onClick={copySetupLink}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                        >
                          <Copy className="h-4 w-4" />
                          Copy setup link
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isFullPortalUserOnVoucherPage && (redeemed || voucher.status === 'redeemed') && voucher.status !== 'booked' && !bookedSlot && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                    <h3 className="font-bold">Use the voucher booking account</h3>
                    <p className="mt-1 text-sm leading-6">
                      You are currently signed in to a normal Bendigo Flying Club portal account. Sign out, then use the setup link from the voucher email to sign in to the restricted voucher booking account.
                    </p>
                    <button
                      type="button"
                      onClick={logout}
                      className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
                    >
                      Sign out of this account
                    </button>
                  </div>
                )}

                {(redeemed || voucher.status === 'redeemed') && !user && voucher.status !== 'booked' && !bookedSlot && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                    <h3 className="font-bold">Sign in before booking</h3>
                    <p className="mt-1 text-sm">
                      Your voucher is linked to a restricted booking account. The final booking is only available from the account attached to this voucher.
                    </p>
                    {setupResendEmail && (
                      <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-amber-800">
                        Setup link sent to {setupResendEmail}. Check junk mail if it does not arrive.
                      </p>
                    )}
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <a
                        href="/"
                        className="inline-flex justify-center rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
                      >
                        Sign in to voucher account
                      </a>
                      <button
                        type="button"
                        onClick={resendSetupLink}
                        disabled={loading}
                        className="inline-flex justify-center rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
                      >
                        Resend setup link
                      </button>
                    </div>
                  </div>
                )}

                {canChooseTime && (
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-bold text-slate-950">Available times</h3>
                        <p className="text-sm text-slate-600">
                          {slots.length} available time{slots.length === 1 ? '' : 's'} found. Aircraft and instructor availability are checked together.
                        </p>
                      </div>
                      <button onClick={loadAvailability} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                        Refresh
                      </button>
                    </div>
                    {calendarMonth && groupedSlots.length > 1 && (
                      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={showPreviousCalendarMonth}
                            disabled={currentMonthIndex <= 0}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label="Previous available month"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <div className="text-center">
                            <p className="font-bold text-slate-950">{calendarMonth.label}</p>
                            <p className="text-xs text-slate-500">Choose a day with available trial flight times</p>
                          </div>
                          <button
                            type="button"
                            onClick={showNextCalendarMonth}
                            disabled={currentMonthIndex < 0 || currentMonthIndex >= availableMonthKeys.length - 1}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label="Next available month"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          {CALENDAR_WEEKDAYS.map(day => (
                            <div key={day} className="py-1">{day}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {calendarMonth.days.map(day => {
                            const isSelected = selectedSlotDate === day.dateKey;
                            const hasSlots = day.slotsCount > 0;
                            return (
                              <button
                                key={day.dateKey}
                                type="button"
                                onClick={() => hasSlots && setSelectedSlotDate(day.dateKey)}
                                disabled={!hasSlots}
                                className={`min-h-14 rounded-xl border p-1 text-center transition ${
                                  isSelected
                                    ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                                    : hasSlots
                                      ? 'border-blue-100 bg-white text-slate-900 hover:border-blue-300 hover:bg-blue-50'
                                      : 'border-transparent bg-transparent text-slate-300'
                                } ${!day.isCurrentMonth ? 'opacity-40' : ''}`}
                              >
                                <span className="block text-sm font-black">{day.dayNumber}</span>
                                {hasSlots && (
                                  <span className={`mt-0.5 block text-[10px] font-semibold ${isSelected ? 'text-blue-100' : 'text-blue-700'}`}>
                                    {day.slotsCount} time{day.slotsCount === 1 ? '' : 's'}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="text-xs text-slate-500">
                            Showing {selectedSlotDate === 'all' ? 'all available dates' : groupedSlotMap.get(selectedSlotDate)?.label || 'selected date'}.
                          </p>
                          <button
                            type="button"
                            onClick={() => setSelectedSlotDate('all')}
                            className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                              selectedSlotDate === 'all'
                                ? 'bg-slate-950 text-white'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            Show all
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="max-h-[30rem] space-y-4 overflow-y-auto pr-1">
                      {visibleSlotGroups.map(group => (
                        <div key={group.dateKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="font-bold text-slate-950">{group.label}</p>
                              <p className="text-xs text-slate-500">
                                {group.slots.length} available time{group.slots.length === 1 ? '' : 's'}
                              </p>
                            </div>
                            <CalendarDays className="h-5 w-5 text-blue-600" />
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {group.slots.map(slot => (
                              <button
                                key={`${slot.startTime}-${slot.aircraftId}-${slot.instructorId}`}
                                onClick={() => bookSlot(slot)}
                                disabled={loading}
                                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-base font-black text-slate-950">{formatSlotTime(slot.startTime, slot.endTime)}</p>
                                    <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{formatSlotDate(slot.startTime)}</p>
                                    <p className="mt-1 text-xs font-semibold text-blue-700">{bookingBlockLabel}</p>
                                  </div>
                                  <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">Book</span>
                                </div>
                                <div className="mt-3 space-y-1 text-sm text-slate-600">
                                  <p>{flightDurationLabel}</p>
                                  <p className="font-semibold text-slate-800">
                                    Aircraft and instructor will be allocated by Bendigo Flying Club.
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                      {slots.length === 0 && (
                        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                          No available times found yet. Try refreshing, or contact Bendigo Flying Club and we can help find a time.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {bookedSlot && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                    <h3 className="font-bold">Trial flight booked</h3>
                    <p className="mt-1 text-sm">
                      {formatSlotDate(bookedSlot.startTime)} at {formatSlotTime(bookedSlot.startTime, bookedSlot.endTime)}
                    </p>
                    <p className="mt-1 text-sm font-semibold">{bookingBlockLabel} including {flightDurationLabel.toLowerCase()}.</p>
                    <p className="mt-1 text-sm">Aircraft and instructor have been allocated internally by Bendigo Flying Club.</p>
                    <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-emerald-800">
                      {confirmationEmailSent
                        ? 'A confirmation email has been sent with these booking details.'
                        : 'Your booking is saved. If you do not receive an email, keep these details or contact Bendigo Flying Club.'}
                    </p>
                  </div>
                )}

                {!bookedSlot && voucher.status === 'booked' && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                    <h3 className="font-bold">This voucher has already been booked</h3>
                    <p className="mt-1 text-sm">
                      Contact Bendigo Flying Club if you need help changing the booking.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

export default TrialVoucherRedeemPage;
