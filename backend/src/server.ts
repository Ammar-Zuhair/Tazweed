import { startPhase11 } from './privacy/worker.js';
import { DeletionService } from './privacy/service.js';
import { AuthService } from './identity/auth.js';
import { startEngagement } from "./engagement/worker.js";
import { pushFromConfig } from "./engagement/provider.js";
import { createApp } from "./app.js";
import { readServerConfig } from "./config.js";
import { createPool } from "./db.js";
import { Security } from "./identity/security.js";
import { providerFromConfig } from "./identity/provider.js";
import { databaseReadiness } from "./readiness.js";
import { storeFromConfig } from "./catalog/media.js";
import { startStockExpiry, startMediaCleanup } from "./catalog/worker.js";
import { startReceiptAlerts } from "./orders/worker.js";
try {
  const config = readServerConfig(),
    pool = createPool(config.DATABASE_URL),
    security = await Security.create(config);
  const state = await databaseReadiness(pool);
  if (!state.migrations || !state.runtimeRole) {
    await pool.end();
    throw new Error(
      "Apply migrations and least-privilege runtime grants before serving",
    );
  }
  const objectStore = storeFromConfig(config);
  const stopMedia = startMediaCleanup(pool, objectStore);
  const server = createApp({
    objectStore,
    config,
    pool,
    security,
    provider: providerFromConfig(config),
    log: (entry) => console.log(JSON.stringify(entry)),
  }).listen(config.PORT, config.HOST, () =>
    console.log(
      JSON.stringify({ event: "listening", port: config.PORT, phase: "11" }),
    ),
  );
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const stopPhase11=startPhase11(pool,new DeletionService(new AuthService(pool,security,providerFromConfig(config)),config,objectStore));
  const stopEngagement = startEngagement(pool, config, pushFromConfig(config));
  const stopAlerts = startReceiptAlerts(pool, config.RECEIPT_REVIEW_ALERT_MINUTES);
  const stopExpiry = startStockExpiry(pool);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      stopExpiry();
      stopAlerts();
      stopMedia();
      const timer = setTimeout(() => process.exit(1), 10000);
      timer.unref();
      server.close(() => {
        void Promise.all([stopEngagement(),stopPhase11()]).then(() => pool.end()).then(() => {
          clearTimeout(timer);
          process.exit(0);
        });
      });
    });
} catch {
  console.error(
    "Backend initialization failed: validate environment, signing keys and service configuration.",
  );
  process.exitCode = 1;
}
