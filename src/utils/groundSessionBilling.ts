export interface GroundSessionPaymentTypeOption {
  id: string;
  name: string;
  active: boolean;
}

export interface GroundSessionRateOption {
  flightTypeId: string;
  enabled: boolean;
  hourlyRate: number;
}

export const buildGroundSessionBillingDefaults = (booking: {
  flightTypeId?: string | null;
  paymentType?: string | null;
}) => ({
  paymentTypeId: booking.flightTypeId || '',
  paymentMethodName: booking.paymentType || '',
});

export const resolveBookingBillingSelection = ({
  paymentTypeId,
  paymentTypeName,
  derivedPaymentTypeName,
  isVoucherBooking = false,
}: {
  paymentTypeId?: string | null;
  paymentTypeName?: string | null;
  derivedPaymentTypeName?: string | null;
  isVoucherBooking?: boolean;
}) => {
  if (isVoucherBooking) {
    return {
      flightTypeId: '',
      paymentType: 'Gift Voucher',
    };
  }

  return {
    flightTypeId: paymentTypeId || '',
    paymentType: derivedPaymentTypeName || paymentTypeName || '',
  };
};

export const isPrepaidPaymentTypeName = (value?: string | null) => {
  const normalised = String(value || '').toLowerCase().replace(/[-_]/g, ' ');
  return normalised.includes('pilot account')
    || normalised.includes('pre paid')
    || normalised.includes('prepaid');
};

export const getAllowedGroundSessionPaymentTypes = <T extends GroundSessionPaymentTypeOption>(
  paymentTypes: T[],
  pricingMode?: 'fixed' | 'flight_type_hourly' | null,
  rates: GroundSessionRateOption[] = [],
) => {
  const active = paymentTypes.filter(type => type.active);
  if (pricingMode !== 'flight_type_hourly') return active;
  const enabledIds = new Set(
    rates
      .filter(rate => rate.enabled && Number(rate.hourlyRate) > 0)
      .map(rate => rate.flightTypeId),
  );
  return active.filter(type => enabledIds.has(type.id));
};

export const getGroundSessionHourlyRate = (
  rates: GroundSessionRateOption[] = [],
  flightTypeId?: string | null,
) => {
  if (!flightTypeId) return 0;
  const rate = rates.find(item => item.flightTypeId === flightTypeId && item.enabled);
  return Number(rate?.hourlyRate || 0);
};

export const resolveGroundSessionPaymentMethod = ({
  paymentTypeName,
  forcedPaymentMethodName,
  currentPaymentMethodName,
  pilotAccountPaymentMethodName,
}: {
  paymentTypeName?: string | null;
  forcedPaymentMethodName?: string | null;
  currentPaymentMethodName?: string | null;
  pilotAccountPaymentMethodName?: string | null;
}) => {
  if (isPrepaidPaymentTypeName(paymentTypeName)) {
    return pilotAccountPaymentMethodName || 'Pilot Account';
  }
  return forcedPaymentMethodName || currentPaymentMethodName || '';
};
