import React from 'react';
import {
  ArchiveRestore,
  CalendarDays,
  ExternalLink,
  History,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { User } from '../../types';
import { supabase } from '../../lib/supabase';
import {
  filterPastVisitors,
  mapPastVisitorRow,
  summarisePastVisitors,
  type PastVisitor,
  type PastVisitorFilter,
} from '../../utils/casualContacts';
import { useGuestBookingConversion } from '../../hooks/useGuestBookingConversion';
import { GuestPromotionModal } from '../Bookings/GuestPromotionModal';

interface PastVisitorsModalProps {
  isOpen: boolean;
  users: User[];
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
  onMembersChanged: () => void | Promise<void>;
}

const PAGE_SIZE = 250;
const MAX_PAGES = 100;

const formatVisitDate = (value?: string) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(date);
};

export const PastVisitorsModal: React.FC<PastVisitorsModalProps> = ({
  isOpen,
  users,
  onClose,
  onOpenProfile,
  onMembersChanged,
}) => {
  const { convertGuestBookingToMember } = useGuestBookingConversion();
  const [visitors, setVisitors] = React.useState<PastVisitor[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<PastVisitorFilter>('all');
  const [promotionVisitor, setPromotionVisitor] = React.useState<PastVisitor | null>(null);
  const [restoringVisitorId, setRestoringVisitorId] = React.useState<string | null>(null);

  const loadVisitors = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const loaded = new Map<string, PastVisitor>();
      let exhausted = false;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data, error: requestError } = await supabase.rpc('list_past_visitors', {
          p_query: '',
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        });
        if (requestError) throw requestError;

        const rows = (data || []).map((row: Record<string, unknown>) => mapPastVisitorRow(row));
        rows.forEach((visitor: PastVisitor) => loaded.set(visitor.id, visitor));
        if (rows.length < PAGE_SIZE) {
          exhausted = true;
          break;
        }
      }

      if (!exhausted) {
        throw new Error('The visitor directory is larger than the safe display limit. Refine the server query before continuing.');
      }
      setVisitors(Array.from(loaded.values()));
    } catch (caught) {
      console.error('Failed to load past visitors:', caught);
      setError(caught instanceof Error ? caught.message : 'Past visitors could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setFilter('all');
    setPromotionVisitor(null);
    void loadVisitors();
  }, [isOpen, loadVisitors]);

  React.useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !promotionVisitor && !restoringVisitorId) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, promotionVisitor, restoringVisitorId]);

  const summary = React.useMemo(() => summarisePastVisitors(visitors), [visitors]);
  const visibleVisitors = React.useMemo(
    () => filterPastVisitors(visitors, query, filter),
    [filter, query, visitors],
  );

  if (!isOpen) return null;

  const refreshAfterChange = async () => {
    await Promise.all([loadVisitors(), Promise.resolve(onMembersChanged())]);
  };

  const restorePromotedProfile = async (visitor: PastVisitor) => {
    if (!visitor.promotedToUserId) return;
    setRestoringVisitorId(visitor.id);
    try {
      await convertGuestBookingToMember({
        casualContactId: visitor.id,
        targetUserId: visitor.promotedToUserId,
        reactivateProfile: true,
      });
      await refreshAfterChange();
    } finally {
      setRestoringVisitorId(null);
    }
  };

  const filterOptions: Array<{ id: PastVisitorFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: summary.total },
    { id: 'needs_profile', label: 'Needs portal profile', count: summary.needsProfile },
    { id: 'portal_profile', label: 'Portal profiles', count: summary.portalProfiles },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0" aria-label="Close past visitors" onClick={() => !restoringVisitorId && onClose()} />
      <section
        className="relative flex h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-slate-50 shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="past-visitors-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
              <History className="h-4 w-4" /> Visitor history
            </div>
            <h2 id="past-visitors-title" className="mt-1 text-xl font-extrabold text-slate-950">Past visitors</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Every previous casual or trial-flight visitor is retained here. Upgrade them to a portal user without sending an invitation, attach them to an existing profile, or restore an archived profile.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void loadVisitors()}
              disabled={loading}
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              aria-label="Refresh past visitors"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} disabled={Boolean(restoringVisitorId)} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-white px-4 pb-4 sm:grid-cols-4 sm:px-6">
          {[
            { label: 'Past visitors', value: summary.total, tone: 'text-slate-950' },
            { label: 'Need a profile', value: summary.needsProfile, tone: 'text-blue-700' },
            { label: 'Portal profiles', value: summary.portalProfiles, tone: 'text-emerald-700' },
            { label: 'Archived profiles', value: summary.archivedProfiles, tone: 'text-amber-700' },
          ].map(item => (
            <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className={`text-xl font-extrabold ${item.tone}`}>{item.value}</p>
              <p className="text-xs font-semibold text-slate-500">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-0 flex-1 lg:max-w-lg">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search visitor name, email or phone"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                autoFocus
              />
              {query && <button type="button" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Clear visitor search"><X className="h-4 w-4" /></button>}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
              {filterOptions.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={`whitespace-nowrap rounded-full border px-3 py-2 text-xs font-bold ${filter === option.id ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {option.label} <span className="ml-1 opacity-75">{option.count}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">Showing {visibleVisitors.length} of {summary.total} visitors</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {loading && visitors.length === 0 ? (
            <div className="grid min-h-64 place-items-center text-center">
              <div><Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-700" /><p className="mt-3 text-sm font-semibold text-slate-600">Loading every past visitor...</p></div>
            </div>
          ) : error ? (
            <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
              <p className="font-bold text-rose-900">Past visitors could not be loaded</p>
              <p className="mt-1 text-sm text-rose-700">{error}</p>
              <button type="button" onClick={() => void loadVisitors()} className="mt-4 rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white">Try again</button>
            </div>
          ) : visibleVisitors.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <div><Users className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 font-bold text-slate-800">No visitors match these filters</p><p className="mt-1 text-sm text-slate-500">Clear the search or choose All to see the complete visitor history.</p></div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleVisitors.map(visitor => {
                const hasProfile = Boolean(visitor.promotedToUserId);
                const archivedProfile = hasProfile && visitor.portalProfileIsActive === false;
                const restoring = restoringVisitorId === visitor.id;
                return (
                  <article key={visitor.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-extrabold text-slate-950">{visitor.name}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${archivedProfile ? 'bg-amber-100 text-amber-800' : hasProfile ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                            {archivedProfile ? 'Profile archived' : hasProfile ? 'Portal profile' : 'Needs portal profile'}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          <p className="flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{visitor.email}</span></p>
                          {visitor.phone && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />{visitor.phone}</p>}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-center">
                        <p className="text-lg font-extrabold text-slate-950">{visitor.bookingCount}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{visitor.bookingCount === 1 ? 'visit' : 'visits'}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
                      <div><p className="font-semibold text-slate-500">First visit</p><p className="mt-0.5 font-bold text-slate-800">{formatVisitDate(visitor.firstBookingAt)}</p></div>
                      <div><p className="font-semibold text-slate-500">Last visit</p><p className="mt-0.5 font-bold text-slate-800">{formatVisitDate(visitor.lastBookingAt)}</p></div>
                    </div>

                    {hasProfile && (
                      <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                        <p className="font-bold">{visitor.portalProfileName || visitor.name}</p>
                        <p className="truncate text-emerald-700">{visitor.portalProfileEmail || visitor.email}</p>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      {!hasProfile ? (
                        <button
                          type="button"
                          onClick={() => setPromotionVisitor(visitor)}
                          disabled={visitor.guestBookingCount < 1}
                          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                          title={visitor.guestBookingCount < 1 ? 'No unlinked guest booking is available to transfer' : undefined}
                        >
                          <UserPlus className="h-4 w-4" /> Upgrade to portal user
                        </button>
                      ) : archivedProfile ? (
                        <button type="button" onClick={() => void restorePromotedProfile(visitor)} disabled={restoring} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                          {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
                          {restoring ? 'Restoring...' : 'Restore portal user'}
                        </button>
                      ) : (
                        <button type="button" onClick={() => onOpenProfile(visitor.promotedToUserId!)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50">
                          <ExternalLink className="h-4 w-4" /> Open profile
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 sm:px-6">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> Booking details remain preserved after upgrade.</span>
          <button type="button" onClick={onClose} disabled={Boolean(restoringVisitorId)} className="min-h-10 rounded-xl border border-slate-300 px-4 font-bold text-slate-700 hover:bg-slate-50">Close</button>
        </footer>
      </section>

      {promotionVisitor && (
        <GuestPromotionModal
          source={{
            casualContactId: promotionVisitor.id,
            name: promotionVisitor.name,
            email: promotionVisitor.email,
            phone: promotionVisitor.phone,
          }}
          users={users}
          reinstateArchivedProfiles
          onClose={() => setPromotionVisitor(null)}
          onComplete={async () => {
            setPromotionVisitor(null);
            await refreshAfterChange();
          }}
        />
      )}
    </div>
  );
};
