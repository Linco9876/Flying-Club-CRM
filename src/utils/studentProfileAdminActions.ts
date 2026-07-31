export const shouldShowXeroContactEditor = ({
  isAdmin,
  providerLoading,
  xeroConnected,
}: {
  isAdmin: boolean;
  providerLoading: boolean;
  xeroConnected: boolean;
}) => isAdmin && !providerLoading && xeroConnected;
