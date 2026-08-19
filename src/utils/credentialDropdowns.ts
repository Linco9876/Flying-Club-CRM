export const normaliseCredentialOption = (value: string) => value.trim().toLowerCase();

type HeldCredential = { type: string; isActive?: boolean };

export const hasCredentialType = (
  heldCredentials: readonly HeldCredential[],
  candidateType: string,
) => {
  const candidate = normaliseCredentialOption(candidateType);
  return Boolean(candidate) && heldCredentials.some(
    credential => credential.isActive !== false
      && normaliseCredentialOption(credential.type) === candidate,
  );
};

export const availableCredentialOptions = (
  configuredOptions: readonly string[],
  heldCredentials: readonly HeldCredential[],
) => configuredOptions.filter(option => !hasCredentialType(heldCredentials, option));

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
