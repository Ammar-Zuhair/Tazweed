export function releaseConfig(
  app: "customer" | "admin" | "courier",
  environment: string,
): null | {
  projectId: string;
  apiUrl: string;
  androidPackage: string;
  iosBundleIdentifier: string;
};
