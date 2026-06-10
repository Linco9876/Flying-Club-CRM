import React, { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle, Gift, Loader2, Plane, Ticket } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

interface PublicVoucher {
  code: string;
  status: string;
  recipientName?: string;
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

const getInitialCode = () => {
  const params = new URLSearchParams(window.location.search);
  return (params.get('code') || '').trim().toUpperCase();
};

export const TrialVoucherRedeemPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [code, setCode] = useState(getInitialCode);
  const [voucher, setVoucher] = useState<PublicVoucher | null>(null);
  const [loading, setLoading] = useState(false);
  const [redeemed, setRedeemed] = useState<{ setupLink?: string | null } | null>(null);
  const [slots, setSlots] = useState<VoucherSlot[]>([]);
  const [bookedSlot, setBookedSlot] = useState<VoucherSlot | null>(null);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });

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
      setRedeemed({ setupLink: null });
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
    if (code || !user) return;
    void loadLinkedVoucher();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user]);

  useEffect(() => {
    if (!user || !code || bookedSlot) return;
    void loadLinkedVoucher();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const redeemVoucher = async () => {
    if (!voucher) return;
    if (!form.fullName || !form.email || !form.phone) {
      toast.error('Full name, email and phone are required');
      return;
    }
    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/trial-flight-voucher?code=${encodeURIComponent(code)}`;
      const { data, error } = await supabase.functions.invoke('trial-voucher-public', {
        body: { action: 'redeem', code, ...form, redirectTo },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRedeemed({ setupLink: data.setupLink });
      toast.success('Voucher linked to your account');
      if (user) await loadAvailability();
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
      setVoucher(current => current ? { ...current, status: 'booked' } : current);
      setSlots([]);
      toast.success('Trial flight booked');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not book this time');
      await loadAvailability();
    } finally {
      setLoading(false);
    }
  };

  const formatSlotDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(value));

  const formatSlotTime = (start: string, end: string) => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`;
  };

  const canChooseTime = Boolean(user && voucher?.status === 'redeemed' && !bookedSlot);

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
                        ? 'Choose an available time below. Your booking block includes the flight plus 30 minutes for briefing and paperwork.'
                        : 'Set your password and sign in to your restricted voucher account before choosing a flight time.'}
                    </p>
                    {redeemed.setupLink && (
                      <a href={redeemed.setupLink} className="mt-3 inline-flex rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                        Set password / continue
                      </a>
                    )}
                  </div>
                )}

                {(redeemed || voucher.status === 'redeemed') && !user && voucher.status !== 'booked' && !bookedSlot && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                    <h3 className="font-bold">Sign in before booking</h3>
                    <p className="mt-1 text-sm">
                      Your voucher is linked, but the final booking is only available from the account attached to this voucher.
                    </p>
                    <a
                      href="/"
                      className="mt-3 inline-flex rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
                    >
                      Sign in to voucher account
                    </a>
                  </div>
                )}

                {canChooseTime && (
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-bold text-slate-950">Available times</h3>
                        <p className="text-sm text-slate-600">Aircraft and instructor availability are checked together.</p>
                      </div>
                      <button onClick={loadAvailability} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                        Refresh
                      </button>
                    </div>
                    <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                      {slots.map(slot => (
                        <button
                          key={`${slot.startTime}-${slot.aircraftId}-${slot.instructorId}`}
                          onClick={() => bookSlot(slot)}
                          disabled={loading}
                          className="w-full rounded-2xl border border-slate-200 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-bold text-slate-950">{formatSlotDate(slot.startTime)}</p>
                              <p className="text-sm text-slate-700">{formatSlotTime(slot.startTime, slot.endTime)}</p>
                            </div>
                            <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">Book</span>
                          </div>
                          <p className="mt-2 text-sm text-slate-600">{slot.aircraftLabel} with {slot.instructorName}</p>
                        </button>
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
                    <p className="mt-1 text-sm">{bookedSlot.aircraftLabel} with {bookedSlot.instructorName}</p>
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
