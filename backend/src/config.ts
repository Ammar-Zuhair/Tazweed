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
