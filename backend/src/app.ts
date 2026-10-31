import express from "express";
import helmet from "helmet";
import cors from "cors";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Config } from "./config.js";
import { ApiError, errorHandler } from "./http.js";
import { Security } from "./identity/security.js";
import { AuthService } from "./identity/auth.js";
import type { OtpProvider } from "./identity/provider.js";
import { identityRouter } from "./identity/routes.js";
import { openapi } from "./openapi.js";
import { databaseReadiness } from "./readiness.js";
export type AppOptions = {
  config: Config;
  pool: pg.Pool;
  security: Security;
  provider: OtpProvider;
  log?: (entry: Record<string, unknown>) => void;
};
export function createApp({
  config,
  pool,
  security,
  provider,
  log = () => {},
}: AppOptions) {
  if (
    provider.mode === "test" &&
    (config.NODE_ENV !== "test" || config.production)
  )
    throw new Error("Test OTP provider restricted to isolated tests");
  if (config.production && provider.mode === "unconfigured")
    throw new Error("Production OTP must be configured");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((req, res, next) => {
    res.locals.safeError = log;
    res.locals.requestId = randomUUID();
    res.set("X-Request-Id", res.locals.requestId);
    res.set("Cache-Control", "no-store");
    const started = performance.now();
    res.on("finish", () =>
      log({
        requestId: res.locals.requestId,
        method: req.method,
        route: req.route?.path ?? "unmatched",
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.origins.includes(origin)) callback(null, true);
        else callback(new ApiError(403, "ORIGIN_DENIED", "المصدر غير مسموح"));
      },
      credentials: false,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Client-App"],
    }),
  );
  app.use(express.json({ limit: "16kb", strict: true }));
  const live = {
    service: "tazweed-backend",
    phase: "05",
    status: "ok",
    businessServices: "identity-only",
  };
  app.get(["/health", "/health/live"], (_req, res) => res.json(live));
  app.get("/health/ready", async (_req, res) => {
    let database = false,
      migrations = false,
      runtimeRole = false;
    try {
      ({ database, migrations, runtimeRole } = await databaseReadiness(pool));
    } catch {}
    const ready =
      database && migrations && runtimeRole && provider.mode !== "unconfigured";
    res
      .status(ready ? 200 : 503)
      .json({
        service: "tazweed-backend",
        phase: "05",
        status: ready ? "ready" : "not-ready",
        database: database ? "connected" : "unavailable",
        migrations: migrations ? "current" : "unavailable",
        runtimeRole: runtimeRole ? "limited" : "unsafe-or-unavailable",
        otp: provider.mode,
      });
  });
  app.get("/api/v1/openapi.json", (_req, res) => res.json(openapi()));
  app.use(
    "/api/v1",
    identityRouter(new AuthService(pool, security, provider), pool),
  );
  app.use((_req, _res, next) =>
    next(new ApiError(404, "NOT_FOUND", "المسار غير موجود")),
  );
  app.use(errorHandler);
  return app;
}
