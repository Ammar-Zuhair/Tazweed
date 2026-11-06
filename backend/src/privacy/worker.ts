import type pg from "pg";
import { policy } from "./policy.js";
import { DeletionService } from "./service.js";
import { processReport } from "../reports/service.js";
export function startPhase11(pool: pg.Pool, s: DeletionService) {
  let stopped = false,
    running: Promise<void> | null = null;
  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      await processReport(pool).catch(() =>
        console.error(JSON.stringify({ event: "report_worker_failed" })),
      );
      if (stopped) return;
      await s
        .processOne()
        .catch(() =>
          console.error(JSON.stringify({ event: "privacy_worker_failed" })),
        );
      if (stopped) return;
      await s
        .removeFiles()
        .catch(() =>
          console.error(JSON.stringify({ event: "privacy_files_failed" })),
        );
      if (policy(s.config).approved)
        await pool
          .query("SELECT privacy_prune_security($1)", [
            s.config.PRIVACY_SECURITY_RETENTION_DAYS,
          ])
          .catch(() =>
            console.error(
              JSON.stringify({ event: "privacy_security_prune_failed" }),
            ),
          );
      await pool
        .query(
          "UPDATE report_jobs SET pdf_bytes=NULL,summary=NULL WHERE expires_at<=now() AND pdf_bytes IS NOT NULL",
        )
        .catch(() => {});
    })().finally(() => {
      running = null;
    });
  };
  const timer = setInterval(tick, 5000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
