import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "../../ui/theme-provider";
import { fonts } from "../../ui/theme-model";
export default function TabLayout() {
  const { colors } = useTheme();
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
          fontSize: 12,
          marginTop: 3,
        },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {(
        [
          { name: "index", title: "مهامي", icon: "bicycle-outline" },
          { name: "earnings", title: "مستحقاتي", icon: "wallet-outline" },
          { name: "account", title: "حسابي", icon: "person-outline" },
        ] as const
      ).map((x) => (
        <Tabs.Screen
          key={x.name}
          name={x.name}
          options={{
            title: x.title,
            tabBarAccessibilityLabel: x.title,
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                accessible={false}
                aria-hidden
                name={x.icon}
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
