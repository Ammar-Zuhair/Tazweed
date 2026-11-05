import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("staging"),
  DATABASE_URL: z
    .url()
    .refine((v) => ["postgres:", "postgresql:"].includes(new URL(v).protocol)),
  PORT: z.coerce.number().int().min(1024).max(65535).default(8084),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_BASE_URL: z.url().default("http://127.0.0.1:8084"),
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  JWT_PRIVATE_KEY: z.string().min(40),
  JWT_PUBLIC_KEY: z.string().min(40),
  OTP_HMAC_SECRET: z.string().regex(/^(?:[a-fA-F0-9]{2}){32,}$/),
  OTP_PROVIDER: z
    .enum(["UNCONFIGURED", "https-gateway"])
    .default("UNCONFIGURED"),
  OTP_PROVIDER_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url().optional(),
  ),
  R2_ACCOUNT_ID: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional()
    .or(z.literal("")),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_BUCKET: z.string().optional(),
  R2_PRIVATE_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url().optional(),
  ),
  OTP_PROVIDER_TOKEN: z.string().optional(),
  RECEIPT_ATTEMPT_LIMIT_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .max(30)
    .default(6),
  RECEIPT_REVIEW_ALERT_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(60),
  PUSH_PROVIDER: z.enum(["UNCONFIGURED", "expo"]).default("UNCONFIGURED"),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  EXPO_CUSTOMER_PROJECT_ID: z.union([z.uuid(), z.literal("")]).optional(),
  EXPO_ADMIN_PROJECT_ID: z.union([z.uuid(), z.literal("")]).optional(),
  EXPO_COURIER_PROJECT_ID: z.union([z.uuid(), z.literal("")]).optional(),
  PUSH_TIMEOUT_MS: z.coerce.number().int().min(500).max(10000).default(5000),
  ROUTING_PROVIDER: z.enum(["UNCONFIGURED", "osrm"]).default("UNCONFIGURED"),
  ROUTING_BASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url().optional(),
  ),
  ROUTING_API_KEY: z.string().optional(),
  ROUTING_PROFILE: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,30}$/)
    .default("driving"),
  ROUTING_TIMEOUT_MS: z.coerce.number().int().min(500).max(10000).default(5000),
  ROUTING_MAX_SNAP_M: z.coerce.number().int().min(1).max(1000).default(200),
});
export function readConfig(input: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      "Invalid environment: " +
        [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(
          ", ",
        ),
    );
  const e = parsed.data;
  const production = e.NODE_ENV === "production" || e.APP_ENV === "production";
  const origins = e.CORS_ALLOWED_ORIGINS.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const u = new URL(origin);
    if (
      origin.includes("*") ||
      u.origin !== origin ||
      u.username ||
      u.password ||
      !["http:", "https:"].includes(u.protocol)
    )
      throw new Error("CORS requires exact origins");
  }
  if (
    production &&
    (!origins.length ||
      origins.some((x) => !x.startsWith("https://")) ||
      !e.PUBLIC_BASE_URL.startsWith("https://") ||
      e.OTP_PROVIDER === "UNCONFIGURED")
  )
    throw new Error(
      "Production requires HTTPS, exact CORS and a configured OTP provider",
    );
  if (
    e.OTP_PROVIDER === "https-gateway" &&
    (!e.OTP_PROVIDER_URL?.startsWith("https://") ||
      !e.OTP_PROVIDER_TOKEN ||
      new URL(e.OTP_PROVIDER_URL).username ||
      new URL(e.OTP_PROVIDER_URL).password)
  )
    throw new Error("OTP gateway requires HTTPS and a server token");
  if (e.PUSH_PROVIDER === "expo" && (!e.EXPO_ACCESS_TOKEN || !e.EXPO_CUSTOMER_PROJECT_ID || !e.EXPO_ADMIN_PROJECT_ID || !e.EXPO_COURIER_PROJECT_ID))
    throw new Error("Expo push requires enhanced-security token and three project IDs");
  if (e.R2_PUBLIC_BUCKET && e.R2_PUBLIC_BUCKET === e.R2_PRIVATE_BUCKET)
    throw new Error("R2 buckets must be separate");
  if (
    e.R2_PUBLIC_BASE_URL &&
    (!e.R2_PUBLIC_BASE_URL.startsWith("https://") ||
      new URL(e.R2_PUBLIC_BASE_URL).username ||
      new URL(e.R2_PUBLIC_BASE_URL).password ||
      new URL(e.R2_PUBLIC_BASE_URL).search ||
      new URL(e.R2_PUBLIC_BASE_URL).hash)
  )
    throw new Error("R2 public URL requires HTTPS");
  if (e.ROUTING_PROVIDER === "osrm") {
    if (!e.ROUTING_BASE_URL) throw new Error("OSRM requires ROUTING_BASE_URL");
    const u = new URL(e.ROUTING_BASE_URL);
    const privateHttp =
      e.APP_ENV !== "production" &&
      !production &&
      u.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
    if (
      (u.protocol !== "https:" && !privateHttp) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      ["router.project-osrm.org", "routing.openstreetmap.de"].includes(
        u.hostname,
      )
    )
      throw new Error(
        "Routing requires an owned HTTPS endpoint (private loopback HTTP in non-production only), without credentials/query/demo servers",
      );
  }
  return {
    ...e,
    production,
    origins,
    JWT_PRIVATE_KEY: e.JWT_PRIVATE_KEY.replaceAll("\\n", "\n"),
    JWT_PUBLIC_KEY: e.JWT_PUBLIC_KEY.replaceAll("\\n", "\n"),
  };
}
export type Config = ReturnType<typeof readConfig>;

export function readServerConfig() {
  const file = (name: string) => {
    try {
      return parseEnv(
        readFileSync(new URL("../" + name, import.meta.url), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Server environment file could not be loaded");
    }
  };
  const configured = Object.fromEntries(
    Object.entries(file(".env")).filter(
      ([, v]) => typeof v === "string" && v.trim() !== "",
    ),
  );
  return readConfig({
    ...file(".env.runtime.local"),
    ...configured,
    ...process.env,
  });
}
