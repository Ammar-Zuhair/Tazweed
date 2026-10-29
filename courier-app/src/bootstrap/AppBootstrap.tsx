import { useEffect, type PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useTheme } from '../ui/theme-provider';
import { Txt } from '../ui/components';

void SplashScreen.preventAutoHideAsync().catch(() => {});
export function AppBootstrap({ children }: PropsWithChildren) {
  const { ready, name, colors } = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    'Tajawal-Regular': require('../../assets/fonts/Tajawal-Regular.ttf'),
    'Tajawal-Medium': require('../../assets/fonts/Tajawal-Medium.ttf'),
    'Tajawal-Bold': require('../../assets/fonts/Tajawal-Bold.ttf'),
  });
  useEffect(() => { if (ready && (fontsLoaded || fontError)) void SplashScreen.hideAsync().catch(() => {}); }, [ready, fontsLoaded, fontError]);
  if (fontError) return <View style={{ flex: 1, justifyContent: 'center', padding: 32, backgroundColor: colors.background }}><Txt accessibilityRole="alert">تعذر تحميل الخط المحلي. أعد فتح التطبيق للمحاولة مجددًا.</Txt></View>;
  if (!ready || !fontsLoaded) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} accessibilityLabel="جارٍ تهيئة التطبيق" /></View>;
  return children;
}
