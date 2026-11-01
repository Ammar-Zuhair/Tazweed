import { expireTimed } from "./stock.js";
import { prunePendingMedia, type ObjectStore } from "./media.js";
import type pg from "pg";
export function startStockExpiry(pool: pg.Pool) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await expireTimed(pool);
    } catch {
      console.error(JSON.stringify({ event: "stock_expiry_failed" }));
    } finally {
      busy = false;
    }
  }, 30000);
  timer.unref();
  return () => clearInterval(timer);
}

export function startMediaCleanup(pool: pg.Pool, store: ObjectStore) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || store.mode === "unconfigured") return;
    busy = true;
    try {
      await prunePendingMedia(pool, store);
    } catch {
      console.error(JSON.stringify({ event: "media_cleanup_failed" }));
    } finally {
      busy = false;
    }
  }, 300000);
  timer.unref();
  return () => clearInterval(timer);
}
