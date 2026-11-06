import { policy } from "./privacy/policy.js";
import { privacyRouter } from "./privacy/routes.js";
import { DeletionService } from "./privacy/service.js";
import { reportsRouter } from "./reports/routes.js";
import { engagementRouter } from "./engagement/routes.js";
import { pushFromConfig } from "./engagement/provider.js";
import { mapsRouter } from "./checkout/maps.js";
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
import { catalogRouter } from "./catalog/routes.js";
import {
  mediaRouter,
  storeFromConfig,
  type ObjectStore,
} from "./catalog/media.js";
import { checkoutRouter } from "./checkout/routes.js";
import { routingFromConfig, type RoutingProvider } from "./checkout/routing.js";
import { deliveryRouter } from "./delivery/routes.js";
import { ordersRouter } from "./orders/routes.js";
export type AppOptions = {
  routingProvider?: RoutingProvider;
  config: Config;
  pool: pg.Pool;
  security: Security;
  provider: OtpProvider;
  objectStore?: ObjectStore;
  log?: (entry: Record<string, unknown>) => void;
};
export function createApp({
  config,
  pool,
  security,
  provider,
  objectStore,
  routingProvider,
  log = () => {},
}: AppOptions) {
  if (
    provider.mode === "test" &&
    (config.NODE_ENV !== "test" || config.production)
  )
    throw new Error("Test OTP provider restricted to isolated tests");
  if (config.production && provider.mode === "unconfigured")
    throw new Error("Production OTP must be configured");
  const store = objectStore ?? storeFromConfig(config);
  if (
    store.mode === "test" &&
    (config.NODE_ENV !== "test" || config.production)
  )
    throw new Error("Test media store restricted");
  const routing = routingProvider ?? routingFromConfig(config);
  if (
    routing.mode === "test" &&
    (config.NODE_ENV !== "test" || config.production)
  )
    throw new Error("Test routing restricted");
  if (config.production && !policy(config).approved)
    throw new Error(
      "Production requires owner-approved privacy policy and support metadata",
    );
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
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "upgrade-insecure-requests": config.production ? [] : null,
        },
      },
    }),
  );
  app.use((req, res, next) =>
    cors({
      origin: (origin, callback) => {
        if (
          !origin ||
          config.origins.includes(origin) ||
          origin === new URL(config.PUBLIC_BASE_URL).origin ||
          origin === req.protocol + "://" + req.get("host")
        )
          callback(null, true);
        else callback(new ApiError(403, "ORIGIN_DENIED", "المصدر غير مسموح"));
      },
      credentials: false,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "X-Client-App",
        "Idempotency-Key",
        "X-Deletion-Flow",
      ],
    })(req, res, next),
  );
  app.use(express.json({ limit: "16kb", strict: true }));
  const live = {
    service: "tazweed-backend",
    phase: "11",
    status: "ok",
    businessServices:
      "identity-catalog-inventory-media-routing-orders-payments-delivery-cash-commission-quality-notifications-operations-reports-privacy",
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
      database &&
      migrations &&
      runtimeRole &&
      provider.mode !== "unconfigured" &&
      store.mode !== "unconfigured" &&
      routing.mode !== "unconfigured" &&
      pushFromConfig(config).mode !== "unconfigured" &&
      policy(config).approved;
    res.status(ready ? 200 : 503).json({
      service: "tazweed-backend",
      phase: "11",
      status: ready ? "ready" : "not-ready",
      database: database ? "connected" : "unavailable",
      migrations: migrations ? "current" : "unavailable",
      runtimeRole: runtimeRole ? "limited" : "unsafe-or-unavailable",
      otp: provider.mode,
      storage: store.mode,
      routing: routing.mode,
      push: pushFromConfig(config).mode,
      privacy: policy(config).approved ? "configured" : "unconfigured",
    });
  });
  app.use(
    privacyRouter(
      new DeletionService(
        new AuthService(pool, security, provider),
        config,
        store,
      ),
    ),
  );
  app.use("/api/v1", reportsRouter(pool, security, config));
  app.get("/api/v1/openapi.json", (_req, res) => res.json(openapi()));
  app.use(
    "/api/v1",
    identityRouter(new AuthService(pool, security, provider), pool),
  );
  app.use(
    "/api/v1",
    engagementRouter(pool, security, config),
    catalogRouter(pool, security),
    mediaRouter(pool, security, store),
    checkoutRouter(pool, security, routing),
    mapsRouter(),
    ordersRouter(pool, security, routing, config),
    deliveryRouter(pool, security),
  );
  app.use((_req, _res, next) =>
    next(new ApiError(404, "NOT_FOUND", "المسار غير موجود")),
  );
  app.use(errorHandler);
  return app;
}
