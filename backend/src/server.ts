import { createApp } from "./app.js";
import { readServerConfig } from "./config.js";
import { createPool } from "./db.js";
import { Security } from "./identity/security.js";
import { providerFromConfig } from "./identity/provider.js";
import { databaseReadiness } from "./readiness.js";
import { storeFromConfig } from "./catalog/media.js";
import { startStockExpiry, startMediaCleanup } from "./catalog/worker.js";
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
      JSON.stringify({ event: "listening", port: config.PORT, phase: "06" }),
    ),
  );
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const stopExpiry = startStockExpiry(pool);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      stopExpiry();
      stopMedia();
      const timer = setTimeout(() => process.exit(1), 10000);
      timer.unref();
      server.close(() => {
        void pool.end().then(() => {
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
