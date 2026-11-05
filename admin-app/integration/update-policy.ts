// No reload, navigation or foreground hook. Fingerprint compatibility is enforced by expo-updates.
export async function downloadOnce(updates: {
  checkForUpdateAsync: () => Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync: () => Promise<unknown>;
}): Promise<void> {
  try {
    const r = await updates.checkForUpdateAsync();
    if (r.isAvailable) await updates.fetchUpdateAsync();
  } catch {
    /* Keep the currently running version. No credentials or error payload logging. */
  }
}
