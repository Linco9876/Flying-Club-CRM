export interface GroundSessionPaymentTypeOption {
  id: string;
  name: string;
  active: boolean;
  groundSessionEnabled: boolean;
  groundSessionHourlyRate: number;
}

export const buildGroundSessionBillingDefaults = (booking: {
  flightTypeId?: string | null;
  paymentType?: string | null;
}) => ({
  paymentTypeId: booking.flightTypeId || '',
  paymentMethodName: booking.paymentType || '',
});

export const isPrepaidPaymentTypeName = (value?: string | null) => {
  const normalised = String(value || '').toLowerCase().replace(/[-_]/g, ' ');
  return normalised.includes('pilot account')
    || normalised.includes('pre paid')
    || normalised.includes('prepaid');
};

export const getAllowedGroundSessionPaymentTypes = <T extends GroundSessionPaymentTypeOption>(
  paymentTypes: T[],
  pricingMode?: 'fixed' | 'flight_type_hourly' | null,
) => {
  const active = paymentTypes.filter(type => type.active);
  if (pricingMode !== 'flight_type_hourly') return active;
  return active.filter(type => type.groundSessionEnabled);
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
