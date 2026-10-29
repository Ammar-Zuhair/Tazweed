import { Stack, LocaleProvider, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../ui/theme-provider';
import { FoundationProvider } from '../data/foundation-provider';
import { AppBootstrap } from '../bootstrap/AppBootstrap';
import { View, Text, Pressable } from 'react-native';

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <View style={{ flex: 1, padding: 32, justifyContent: 'center', backgroundColor: '#FFFFFF', direction: 'rtl', gap: 20 }}><Text style={{ color: '#102D46', fontSize: 20 }}>تعذر عرض الصفحة</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={{ color: '#B94700', fontSize: 18 }}>إعادة المحاولة</Text></Pressable></View>;
}
function Navigation() {
  const { name, colors } = useTheme();
  return <AppBootstrap><FoundationProvider><StatusBar style={name === 'dark' ? 'light' : 'dark'} /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} /></FoundationProvider></AppBootstrap>;
}
export default function RootLayout() {
  return <SafeAreaProvider><ThemeProvider><LocaleProvider direction="rtl"><Navigation /></LocaleProvider></ThemeProvider></SafeAreaProvider>;
}
