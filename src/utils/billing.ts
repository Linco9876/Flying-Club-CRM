import { AircraftRate } from '../types';

export type ChargeType = 'tach' | 'flat' | 'per_pax' | 'free' | 'not_used';

export interface BillingCalculationInput {
  rate?: Pick<AircraftRate, 'chargeType' | 'soloRate' | 'dualRate' | 'flatSurcharge' | 'weekendSurcharge'> | null;
  durationHours: number;
  isDual: boolean;
  passengerCount?: number | null;
  startTime?: string | Date | null;
}

export const isPrepaidPaymentMethod = (paymentType?: string | null) => {
  const value = (paymentType || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  return (
    value.includes('pilot account') ||
    value.includes('prepaid') ||
    value.includes('pre paid')
  );
};

export const isVoucherPaymentMethod = (paymentType?: string | null) => {
  const value = (paymentType || '').toLowerCase().replace(/[-_]/g, ' ');
  return value.includes('voucher') || value.includes('gift certificate');
};

export const isNoChargeRate = (chargeType?: ChargeType | null) =>
  chargeType === 'free' || chargeType === 'not_used';

export const isWeekend = (date?: string | Date | null) => {
  if (!date) return false;
  const day = new Date(date).getDay();
  return day === 0 || day === 6;
};

export const calculateFlightCost = ({
  rate,
  durationHours,
  isDual,
  passengerCount,
  startTime,
}: BillingCalculationInput) => {
  if (!rate || isNoChargeRate(rate.chargeType)) return 0;

  const baseRate = Number(isDual ? rate.dualRate : rate.soloRate) || 0;
  const flatSurcharge = Number(rate.flatSurcharge) || 0;
  const weekendSurcharge = isWeekend(startTime) ? Number(rate.weekendSurcharge) || 0 : 0;
  const duration = Math.max(0, Number(durationHours) || 0);
  const passengers = Math.max(1, Number(passengerCount) || 1);

  let subtotal = 0;
  if (rate.chargeType === 'flat') {
    subtotal = baseRate;
  } else if (rate.chargeType === 'per_pax') {
    subtotal = baseRate * passengers;
  } else {
    subtotal = baseRate * duration;
  }

  return Math.max(0, Number((subtotal + flatSurcharge + weekendSurcharge).toFixed(2)));
};
