export interface XeroAccountLike {
  code?: string | null;
  type?: string | null;
  status?: string | null;
}

const normalise = (value: unknown) => String(value || "").trim().toUpperCase();

export const findExistingActiveXeroBankAccountCode = (
  accounts: XeroAccountLike[],
  selectedCode: unknown,
) => {
  const code = normalise(selectedCode);
  if (!code) return "";
  const selected = accounts.find((account) =>
    normalise(account.status) === "ACTIVE" &&
    normalise(account.type) === "BANK" &&
    normalise(account.code) === code
  );
  return String(selected?.code || "").trim();
};
