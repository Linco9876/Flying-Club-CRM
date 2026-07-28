export interface XeroAccountLike {
  code?: string | null;
  type?: string | null;
  status?: string | null;
}

const normalise = (value: unknown) => String(value || '').trim().toUpperCase();

export const isActiveXeroBankAccount = (account: XeroAccountLike) =>
  normalise(account.status) === 'ACTIVE' &&
  normalise(account.type) === 'BANK' &&
  Boolean(normalise(account.code));

export const hasSelectedActiveXeroBankAccount = (
  accounts: XeroAccountLike[],
  selectedCode: unknown,
) => {
  const code = normalise(selectedCode);
  return Boolean(code) && accounts.some(account =>
    isActiveXeroBankAccount(account) && normalise(account.code) === code
  );
};
