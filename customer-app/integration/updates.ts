// Call once after root bootstrap, NOT on every foreground/navigation.
// Pair with checkAutomatically: 'NEVER', fallbackToCacheTimeout: 0 in native config.
import * as Updates from 'expo-updates';
let requested = false;
export async function downloadUpdateForNextLaunch(): Promise<void> {
  if (__DEV__ || requested || !Updates.isEnabled) return;
  requested = true;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) await Updates.fetchUpdateAsync();
    // Never reloadAsync here. A downloaded compatible update launches next cold start.
  } catch {
    // Preserve current working version; record only a redacted error code in real monitoring.
  }
}
