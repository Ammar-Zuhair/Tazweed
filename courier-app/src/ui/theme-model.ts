import tokens from '../../assets/theme-tokens.json';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ThemeName = 'light' | 'dark';
export const themeStorageKey = 'tazweed.theme.v1';
export const parsePreference = (value: unknown): ThemePreference =>
  value === 'light' || value === 'dark' ? value : 'system';
export const resolveTheme = (preference: ThemePreference, system: string | null | undefined): ThemeName =>
  preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
export const palette = tokens.palette;
export const themes = { light: tokens.light, dark: tokens.dark };
export const fonts = tokens.fontFamily;
export type ThemeColors = typeof tokens.light;
