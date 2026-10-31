import { Stack, LocaleProvider, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "../ui/theme-provider";
import { CourierProvider, useCourier } from "../data/courier-provider";
import { AppBootstrap } from "../bootstrap/AppBootstrap";
import { View, Text, Pressable } from "react-native";
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View
      style={{
        flex: 1,
        padding: 32,
        justifyContent: "center",
        backgroundColor: "#FFFFFF",
        direction: "rtl",
        gap: 20,
      }}
    >
      <Text style={{ color: "#102D46", fontSize: 20 }}>تعذر عرض الصفحة</Text>
      <Pressable accessibilityRole="button" onPress={retry}>
        <Text style={{ color: "#B94700", fontSize: 18 }}>إعادة المحاولة</Text>
      </Pressable>
    </View>
  );
}
function Routes() {
  const { name, colors } = useTheme();
  const { signedIn } = useCourier();
  return (
    <>
      <StatusBar style={name === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          {[
            "(tabs)",
            "task",
            "pending",
            "report",
            "cash",
            "notifications",
            "appearance",
            "policies",
            "preview-lab",
          ].map((name) => (
            <Stack.Screen key={name} name={name} />
          ))}
        </Stack.Protected>
      </Stack>
    </>
  );
}
function Navigation() {
  return (
    <AppBootstrap>
      <CourierProvider>
        <Routes />
      </CourierProvider>
    </AppBootstrap>
  );
}
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LocaleProvider direction="rtl">
          <Navigation />
        </LocaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
