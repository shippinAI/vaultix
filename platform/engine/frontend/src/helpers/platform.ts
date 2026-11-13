export const isVaultixCloud = () => {
  const origin = window.location.origin;
  return (
    origin.includes("https://vaultix.shippin.cloud") ||
    origin.includes("https://us.vaultix.shippin.cloud") ||
    origin.includes("https://eu.vaultix.shippin.cloud")
  );
};
