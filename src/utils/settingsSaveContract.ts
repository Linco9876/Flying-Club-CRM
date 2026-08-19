export type SettingsAction = 'save' | 'cancel';

export const settingsHandlerName = (sectionId: string, action: SettingsAction) =>
  `__${sectionId.replace(/-/g, '')}Settings${action === 'save' ? 'Save' : 'Cancel'}`;

export const requireSettingsHandler = (
  registry: Record<string, unknown>,
  sectionId: string,
  action: SettingsAction,
) => {
  const key = settingsHandlerName(sectionId, action);
  const handler = registry[key];
  if (typeof handler !== 'function') {
    throw new Error(`The ${sectionId} settings screen is not ready to ${action}. Refresh the page and try again.`);
  }
  return handler as () => void | Promise<void>;
};
