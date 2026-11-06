import { releaseConfig } from "./integration/release-config";
import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const environment = process.env.EXPO_PUBLIC_APP_ENV ?? "preview";
  const native = releaseConfig("admin", environment);
  return {
    ...config,
    name: "تزويد — الإدارة",
    slug: "tazweed-admin",
    scheme: native ? "tazweed-admin" : "tazweed-admin-preview",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/icon.png",
    ios: {
      buildNumber: "1",
      supportsTablet: true,
      bundleIdentifier:
        native?.iosBundleIdentifier ?? "com.tazweed.preview.admin",
      icon: "./assets/icon.png",
      infoPlist: {
        CFBundleAllowMixedLocalizations: true,
        CFBundleLocalizations: ["ar"],
        CFBundleDevelopmentRegion: "ar",
      },
    },
    android: {
      versionCode: 1,
      ...(process.env.GOOGLE_SERVICES_JSON
        ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
        : {}),
      package: native?.androidPackage ?? "com.tazweed.preview.admin",
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
      ["expo-notifications", { defaultChannel: "tazweed-alerts-v1" }],
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

    runtimeVersion: native ? { policy: "fingerprint" } : undefined,
    updates: native
      ? {
          enabled: true,
          url: "https://u.expo.dev/" + native.projectId,
          checkAutomatically: "NEVER",
          fallbackToCacheTimeout: 0,
        }
      : {
          enabled: false,
          checkAutomatically: "NEVER",
          fallbackToCacheTimeout: 0,
        },
    extra: {
      ...(native
        ? { eas: { projectId: native.projectId }, apiUrl: native.apiUrl }
        : {}),
      supportsRTL: true,
      forcesRTL: true,
      appKind: "admin",
      environment,
      dataMode: "backend",
      phase: "11",
    },
  };
};
