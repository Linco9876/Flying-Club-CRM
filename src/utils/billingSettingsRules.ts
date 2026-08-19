import type { FlightType, PaymentMethod } from '../hooks/useBillingSettings';

const duplicates = (values: string[]) => {
  const seen = new Set<string>();
  return values.some(value => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return true;
    seen.add(key);
    return false;
  });
};

export const getBillingSettingsValidationError = (
  flightTypes: FlightType[],
  paymentMethods: PaymentMethod[],
) => {
  const activeTypes = flightTypes.filter(type => type.active);
  const activeMethods = paymentMethods.filter(method => method.active);
  if (activeTypes.length === 0) return 'Keep at least one active Payment Type.';
  if (activeMethods.length === 0) return 'Keep at least one active Payment Method.';
  if (activeTypes.some(type => !type.name.trim())) return 'Every active Payment Type needs a name.';
  if (activeMethods.some(method => !method.name.trim())) return 'Every active Payment Method needs a name.';
  if (duplicates(activeTypes.map(type => type.name))) return 'Active Payment Type names must be unique.';
  if (duplicates(activeMethods.map(method => method.name))) return 'Active Payment Method names must be unique.';

  const activeMethodIds = new Set(activeMethods.map(method => method.id));
  const invalidForcedType = activeTypes.find(type =>
    type.forcedPaymentMethodId && !activeMethodIds.has(type.forcedPaymentMethodId)
  );
  if (invalidForcedType) return `${invalidForcedType.name} is linked to a Payment Method that is turned off.`;

  const invalidGroundRate = activeTypes.find(type =>
    type.groundSessionEnabled && (!Number.isFinite(type.groundSessionHourlyRate) || type.groundSessionHourlyRate < 0)
  );
  if (invalidGroundRate) return `${invalidGroundRate.name} needs a valid non-negative ground-session rate.`;
  return null;
};
