import { useSyncExternalStore } from 'react';

const query = '(prefers-color-scheme: dark)';
function subscribe(listener: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
function snapshot(): 'light' | 'dark' {
  return window.matchMedia(query).matches ? 'dark' : 'light';
}
const serverSnapshot = (): 'light' | 'dark' => 'light';

// Read media state as an external store; never freeze the initial browser scheme.
export function useSystemTheme() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
