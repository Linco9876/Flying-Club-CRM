import type { MembershipStatusEvent } from '../types';

const EVENT_TITLES: Record<string, string> = {
  application_submitted: 'Membership application submitted',
  application_rejected: 'Membership application rejected',
  membership_commenced: 'Membership approved and commenced',
  legacy_membership_imported: 'Existing membership added to the portal',
  fee_disposition_changed: 'Membership fee status changed',
  membership_fee_waived: 'Membership fee waived',
  membership_ceased_non_payment: 'Membership ceased for non-payment',
  membership_change_requested: 'Membership change requested',
  membership_change_approved: 'Membership change approved',
  membership_change_cancelled: 'Membership change cancelled',
  membership_class_changed: 'Membership class changed',
  membership_ended: 'Membership ended',
  membership_reinstated: 'Membership reinstated',
};

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

const number = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export const humaniseMembershipAuditValue = (value: unknown) => {
  const cleaned = text(value);
  if (!cleaned) return null;
  return cleaned
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
};

export const membershipAuditEventTitle = (eventType: string) =>
  EVENT_TITLES[eventType] || humaniseMembershipAuditValue(eventType) || 'Membership activity';

const money = (value: unknown) => {
  const parsed = number(value);
  if (parsed === null) return null;
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(parsed);
};

const sentence = (value: string) => value.endsWith('.') ? value : `${value}.`;

export const membershipAuditEventDescription = (
  event: Pick<MembershipStatusEvent, 'eventType' | 'details'>,
) => {
  const details = event.details || {};
  const reason = text(details.reason);
  const source = humaniseMembershipAuditValue(details.source);
  const membershipClass = humaniseMembershipAuditValue(
    details.toClassCode || details.toClass || details.membershipClassCode || details.class,
  );
  const effectiveOn = text(details.effectiveOn);
  const authorityReference = text(details.authorityReference);

  switch (event.eventType) {
    case 'application_submitted':
      return source ? `Submitted through ${source.toLowerCase()}.` : 'Submitted through the membership portal.';
    case 'application_rejected':
      return reason ? sentence(reason) : 'The application was not approved.';
    case 'membership_commenced': {
      const method = humaniseMembershipAuditValue(details.method);
      const amountDue = money(details.amountDue);
      const feeStatus = humaniseMembershipAuditValue(details.feeDisposition);
      return [
        membershipClass ? `${membershipClass} membership commenced` : 'Membership commenced',
        method ? `via ${method.toLowerCase()}` : null,
        amountDue ? `with ${amountDue} recorded as due` : null,
        feeStatus ? `(${feeStatus})` : null,
      ].filter(Boolean).join(' ') + '.';
    }
    case 'legacy_membership_imported':
      return [
        membershipClass ? `${membershipClass} membership was added from existing club records.` : 'Membership was added from existing club records.',
        reason ? sentence(reason) : null,
      ].filter(Boolean).join(' ');
    case 'fee_disposition_changed': {
      const from = humaniseMembershipAuditValue(details.from);
      const to = humaniseMembershipAuditValue(details.to);
      const change = from && to ? `Fee status changed from ${from} to ${to}.` : 'The fee status was updated.';
      return `${change}${reason ? ` ${sentence(reason)}` : ''}`;
    }
    case 'membership_fee_waived': {
      const waiverType = humaniseMembershipAuditValue(details.type);
      return [
        waiverType ? `${waiverType} waiver authorised.` : 'Annual fee waiver authorised.',
        reason ? sentence(reason) : null,
        authorityReference ? `Authority: ${sentence(authorityReference)}` : null,
      ].filter(Boolean).join(' ');
    }
    case 'membership_ceased_non_payment':
      return 'The payment grace period expired without the annual fee being cleared.';
    case 'membership_change_requested':
    case 'membership_change_approved': {
      const action = event.eventType === 'membership_change_requested' ? 'requested' : 'approved';
      return [
        membershipClass ? `Change to ${membershipClass} ${action}.` : `Membership change ${action}.`,
        effectiveOn ? `Effective ${effectiveOn}.` : null,
        reason ? sentence(reason) : null,
      ].filter(Boolean).join(' ');
    }
    case 'membership_change_cancelled':
      return reason ? sentence(reason) : 'The pending membership change was cancelled.';
    case 'membership_class_changed':
      return [
        membershipClass ? `Membership changed to ${membershipClass}.` : 'The membership class was changed.',
        effectiveOn ? `Effective ${effectiveOn}.` : null,
      ].filter(Boolean).join(' ');
    case 'membership_ended':
    case 'membership_reinstated': {
      const from = humaniseMembershipAuditValue(details.from);
      const to = humaniseMembershipAuditValue(details.to);
      return [
        from && to ? `Legal status changed from ${from} to ${to}.` : 'The legal membership status was updated.',
        reason ? sentence(reason) : null,
      ].filter(Boolean).join(' ');
    }
    default:
      return reason ? sentence(reason) : 'Recorded in the membership system.';
  }
};

export const membershipAuditActorLabel = ({
  actorId,
  actorName,
  memberId,
}: {
  actorId?: string | null;
  actorName?: string | null;
  memberId: string;
}) => {
  if (!actorId) return 'Automated system';
  if (actorName?.trim()) return actorName.trim();
  if (actorId === memberId) return 'Member';
  return 'Staff account';
};
