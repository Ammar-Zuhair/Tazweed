import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../../ui/theme-provider';
import { fonts } from '../../ui/theme-model';
export default function TabLayout() {
  const { colors } = useTheme();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.textMuted, tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border, height: 76, paddingTop: 8, paddingBottom: 12 }, tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 12, marginTop: 3 }, sceneStyle: { backgroundColor: colors.background } }}>
    <Tabs.Screen name="index" options={{ title: 'الرئيسية', tabBarAccessibilityLabel: 'الرئيسية', tabBarIcon: ({ color, size }) => <Ionicons accessible={false} name="home-outline" color={typeof color === 'string' ? color : colors.textMuted} size={size} /> }} />
    <Tabs.Screen name="categories" options={{ title: 'الأقسام', tabBarAccessibilityLabel: 'الأقسام', tabBarIcon: ({ color, size }) => <Ionicons accessible={false} name="grid-outline" color={typeof color === 'string' ? color : colors.textMuted} size={size} /> }} />
    <Tabs.Screen name="orders" options={{ title: 'طلباتي', tabBarAccessibilityLabel: 'طلباتي', tabBarIcon: ({ color, size }) => <Ionicons accessible={false} name="receipt-outline" color={typeof color === 'string' ? color : colors.textMuted} size={size} /> }} />
    <Tabs.Screen name="account" options={{ title: 'حسابي', tabBarAccessibilityLabel: 'حسابي', tabBarIcon: ({ color, size }) => <Ionicons accessible={false} name="person-outline" color={typeof color === 'string' ? color : colors.textMuted} size={size} /> }} />
  </Tabs>;
}
