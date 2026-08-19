export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
};

const normaliseSearchText = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .trimStart()
  .toLocaleLowerCase();

export const filterSelectOptionsByPrefix = <T extends Pick<SearchableSelectOption, 'label'>>(
  options: readonly T[],
  query: string,
) => {
  const prefix = normaliseSearchText(query.trimEnd());
  if (!prefix) return [...options];
  return options.filter(option => normaliseSearchText(option.label).startsWith(prefix));
};
