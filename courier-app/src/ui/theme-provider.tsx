import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { parsePreference, resolveTheme, themeStorageKey, themes, type ThemeColors, type ThemeName, type ThemePreference } from './theme-model';

type ThemeContextValue = { ready: boolean; name: ThemeName; colors: ThemeColors; preference: ThemePreference; persistenceError: boolean; setPreference: (value: ThemePreference) => void };
const Context = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [preference, setStoredPreference] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);
  const [persistenceError, setPersistenceError] = useState(false);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(themeStorageKey)
      .then(value => { if (alive) setStoredPreference(parsePreference(value)); })
      .catch(() => { if (alive) setPersistenceError(true); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  const name = resolveTheme(preference, system);
  const value = useMemo<ThemeContextValue>(() => ({ ready, name, colors: themes[name], preference, persistenceError,
    setPreference: next => {
      setStoredPreference(next);
      AsyncStorage.setItem(themeStorageKey, next).then(() => setPersistenceError(false)).catch(() => setPersistenceError(true));
    },
  }), [ready, name, preference, persistenceError]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTheme() {
  const value = useContext(Context);
  if (!value) throw new Error('ThemeProvider is required');
  return value;
}
