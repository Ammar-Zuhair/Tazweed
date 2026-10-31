import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "../../ui/theme-provider";
import { fonts } from "../../ui/theme-model";
export default function TabLayout() {
  const { colors } = useTheme();
  const tabs = [
    ["index", "اللوحة", "grid-outline"],
    ["orders", "الطلبات", "receipt-outline"],
    ["catalog", "الكتالوج", "cube-outline"],
    ["more", "الأدوات", "apps-outline"],
    ["settings", "المظهر", "settings-outline"],
  ] as const;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          height: 76,
          paddingTop: 8,
          paddingBottom: 12,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.bold,
          fontSize: 11,
          marginTop: 3,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {tabs.map(([name, title, icon]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarAccessibilityLabel: title,
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name={icon}
                accessible={false}
                color={typeof color === "string" ? color : colors.textMuted}
                size={size}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
