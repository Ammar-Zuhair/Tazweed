import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Security } from "../identity/security.js";
import { authenticate } from "../identity/access.js";
import { parse, ApiError } from "../http.js";
import { createReport, reportJob, reportInput } from "./service.js";
export function reportsRouter(pool: pg.Pool, security: Security, c: Config) {
  const r = Router();
  r.use("/admin/reports", authenticate(pool, security));
  r.post("/admin/reports/monthly-sales", async (req, res) =>
    res.json(
      await createReport(
        pool,
        c,
        res.locals.identity,
        req.get("Idempotency-Key") ?? "",
        parse(reportInput, req.body),
      ),
    ),
  );
  r.get("/admin/reports/:id", async (req, res) => {
    const v = await reportJob(
      pool,
      res.locals.identity,
      parse(z.uuid(), req.params.id),
    );
    res.json({
      id: v.id,
      state: v.state,
      error: v.error_message,
      summary: v.summary,
      expiresAt: v.expires_at,
    });
  });
  r.get("/admin/reports/:id/download", async (req, res) => {
    const v = await reportJob(
      pool,
      res.locals.identity,
      parse(z.uuid(), req.params.id),
      true,
    );
    if (v.state !== "ready" || !v.pdf_bytes)
      throw new ApiError(
        409,
        "REPORT_NOT_READY",
        "التقرير لم يجهز أو أخفق؛ حدّث حالته",
      );
    res
      .type("application/pdf")
      .set(
        "Content-Disposition",
        `attachment; filename="tazweed-${v.parameters.year}-${v.parameters.month}.pdf"`,
      )
      .send(v.pdf_bytes);
  });
  return r;
}
