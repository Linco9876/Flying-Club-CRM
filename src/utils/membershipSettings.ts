export const positiveIntegerList = (
  value: string,
  fallback: number[],
  maximumItems = 10,
) => {
  const parsed = value
    .split(',')
    .map(item => Number(item.trim()))
    .filter(item => Number.isInteger(item) && item > 0)
    .slice(0, maximumItems);
  return parsed.length ? Array.from(new Set(parsed)) : fallback;
};

export const membershipProductCodeIsValid = (value: string) =>
  /^[a-z0-9][a-z0-9_-]{1,49}$/.test(value.trim().toLowerCase());

export const membershipProductsAreValid = (products: Array<{
  code: string;
  name: string;
  annualFee: number;
}>) => {
  if (products.length === 0) return false;
  const codes = products.map(product => product.code.trim().toLowerCase());
  return products.every((product, index) =>
    membershipProductCodeIsValid(product.code)
    && product.name.trim().length >= 2
    && Number.isFinite(product.annualFee)
    && product.annualFee >= 0
    && codes.indexOf(codes[index]) === index
  );
};

export const scholarshipSettingsAreValid = ({
  defaultAmount,
  minimumAmount,
}: {
  defaultAmount: number;
  minimumAmount: number;
}) =>
  Number.isFinite(defaultAmount)
  && Number.isFinite(minimumAmount)
  && minimumAmount >= 0.01
  && defaultAmount >= minimumAmount;

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const statutoryRegisterCsv = (rows: Array<Record<string, unknown>>) => {
  const headings = [
    'Name',
    'Residential address',
    'Membership class',
    'Commenced',
    'Ceased',
    'Status',
  ];
  const lines = rows.map(row => [
    row.name,
    row.residential_address,
    row.membership_class,
    row.commenced_at ? String(row.commenced_at).slice(0, 10) : '',
    row.ceased_at ? String(row.ceased_at).slice(0, 10) : '',
    row.legal_status,
  ].map(csvCell).join(','));
  return [headings.join(','), ...lines].join('\r\n');
};
