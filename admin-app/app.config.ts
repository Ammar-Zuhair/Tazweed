import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = process.env.EXPO_PUBLIC_APP_ENV ?? "preview";
  if (environment === "production") {
    throw new Error(
      "Phase 03 uses local preview repositories. Production builds are disabled until real services are implemented.",
    );
  }
  return {
    ...config,
    name: "تزويد — الإدارة",
    slug: "tazweed-admin",
    scheme: "tazweed-admin-preview",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/icon.png",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.tazweed.preview.admin",
      icon: "./assets/icon.png",
      infoPlist: {
        CFBundleAllowMixedLocalizations: true,
        CFBundleLocalizations: ["ar"],
        CFBundleDevelopmentRegion: "ar",
      },
    },
    android: {
      package: "com.tazweed.preview.admin",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-foreground.png",
        backgroundColor: "#FFFFFF",
      },
    },
    web: {
      bundler: "metro",
      output: "static",
      name: "تزويد — الإدارة",
      favicon: "./assets/icon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-localization",
        {
          supportedLocales: { ios: ["ar"], android: ["ar"] },
          supportsRTL: true,
          forcesRTL: true,
        },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-light.png",
          imageWidth: 240,
          resizeMode: "contain",
          backgroundColor: "#FFFFFF",
          dark: {
            image: "./assets/splash-dark.png",
            backgroundColor: "#071827",
          },
        },
      ],
      "expo-font",
    ],

    extra: {
      supportsRTL: true,
      forcesRTL: true,
      appKind: "admin",
      environment,
      dataMode: "fake",
      phase: "03",
    },
  };
};
