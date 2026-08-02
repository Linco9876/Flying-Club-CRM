export const normaliseCredentialOption = (value: string) => value.trim().toLowerCase();

export const isConfiguredCredentialOption = (value: string, options: string[]) => {
  const target = normaliseCredentialOption(value);
  return Boolean(target) && options.some(option => normaliseCredentialOption(option) === target);
};

export const inferLicenceIssuingAuthority = (licenceType: string) => {
  const type = normaliseCredentialOption(licenceType);
  if (type.includes('casa')) return 'CASA';
  if (type.includes('raaus') || type.includes('recreational aviation australia')) return 'RAAus';
  return '';
};
