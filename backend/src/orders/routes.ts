import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import type { Security } from "../identity/security.js";
import type { Config } from "../config.js";
import type { RoutingProvider } from "../checkout/routing.js";
import {
  authenticate,
  customerOnly,
  accessScope,
  requirePermission,
  type Identity,
} from "../identity/access.js";
import { parse, forbidden, notFound } from "../http.js";
import { id, page } from "../catalog/contracts.js";
import { transaction } from "../db.js";
import { audit } from "../identity/audit.js";
import * as c from "./contracts.js";
import * as s from "./service.js";
import { detail } from "./views.js";
import { order } from "./core.js";
import { finance } from "./finance.js";
export function ordersRouter(
  pool: pg.Pool,
  security: Security,
  routing: RoutingProvider,
  config: Config,
) {
  const r = Router();
  r.use("/orders", authenticate(pool, security), (_req, res, next) => {
    customerOnly(res.locals.identity);
    next();
  });
  r.use(
    ["/admin/orders", "/admin/payment-methods"],
    authenticate(pool, security),
    (_req, res, next) => {
      if ((res.locals.identity as Identity).kind !== "staff") throw forbidden();
      next();
    },
  );
  const key = (req: any) => req.get("Idempotency-Key") ?? "";
  const readDetail = (i: Identity, oid: string) =>
    transaction(pool, async (db) => {
      await db.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      return detail(db, i, oid, config.RECEIPT_REVIEW_ALERT_MINUTES);
    });
  r.post("/orders", async (req, res) =>
    res.json(
      await s.submitOrder(
        pool,
        res.locals.identity,
        key(req),
        parse(c.submit, req.body),
      ),
    ),
  );
  for (const prefix of ["/orders", "/admin/orders"]) {
    r.get(prefix, async (req, res) => {
      const i = res.locals.identity as Identity,
        q = parse(page, req.query);
      const scope =
        i.kind === "staff" ? await accessScope(pool, i, "orders.review") : null;
      if (scope && !scope.global && !scope.branchIds.length) throw forbidden();
      const rows = (
        await pool.query(
          `SELECT id,order_number,kind,payment_kind,status,review_stage,version,created_at FROM orders WHERE ($1::uuid IS NULL OR customer_id=$1) AND ($2::boolean OR coalesce(branch_id,catalog_branch_id)=ANY($3::uuid[])) AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5`,
          [
            i.kind === "customer" ? i.id : null,
            !scope || scope.global,
            scope?.branchIds ?? [],
            q.cursor ?? null,
            q.limit + 1,
          ],
        )
      ).rows;
      res.json({
        items: rows.slice(0, q.limit),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
        source: "backend",
      });
    });
    r.get(prefix + "/:id", async (req, res) =>
      res.json(await readDetail(res.locals.identity, parse(id, req.params.id))),
    );
  }
  r.get("/orders/:id/payment-methods", async (req, res) => {
    const o = await order(pool, res.locals.identity, parse(id, req.params.id));
    const q = (
      await pool.query("SELECT status FROM order_quotes WHERE id=$1", [
        o.current_quote_id,
      ])
    ).rows[0];
    if (
      q?.status !== "accepted" ||
      o.status !== "pending_review" ||
      o.payment_kind !== "transfer"
    )
      throw forbidden();
    res.json({
      items: (
        await pool.query(
          "SELECT id,name_ar FROM payment_methods WHERE active AND (branch_id IS NULL OR branch_id=$1) ORDER BY sort_order,id",
          [o.branch_id],
        )
      ).rows,
    });
  });
  const customerActions = [
    ["decision", c.decision, s.decideQuote],
    ["payment-kind", c.paymentKind, s.setPaymentKind],
    ["instructions", c.instruction, s.issueInstructions],
    ["cancel", c.reason, s.cancelOrder],
  ] as const;
  for (const [path, schema, fn] of customerActions)
    r.post("/orders/:id/" + path, async (req, res) =>
      res.json(
        await fn(
          pool,
          res.locals.identity,
          parse(id, req.params.id),
          key(req),
          parse(schema as z.ZodType, req.body),
        ),
      ),
    );
  r.post("/orders/:id/receipts", async (req, res) =>
    res.json(
      await s.reportReceipt(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        key(req),
        parse(c.receipt, req.body),
        config.RECEIPT_ATTEMPT_LIMIT_PER_HOUR,
      ),
    ),
  );
  r.post("/orders/:id/payments/:paymentId/images", async (req, res) =>
    res.json(
      await s.retryImage(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        parse(id, req.params.paymentId),
        key(req),
        parse(c.attempt, req.body),
        config.RECEIPT_ATTEMPT_LIMIT_PER_HOUR,
      ),
    ),
  );
  r.post("/admin/orders/:id/quotes", async (req, res) =>
    res.json(
      await s.issueQuote(
        pool,
        routing,
        res.locals.identity,
        parse(id, req.params.id),
        key(req),
        parse(c.issue, req.body),
      ),
    ),
  );
  r.post("/admin/orders/:id/confirm", async (req, res) =>
    res.json(
      await s.confirmOrder(
        pool,
        routing,
        res.locals.identity,
        parse(id, req.params.id),
        key(req),
        parse(c.version, req.body),
      ),
    ),
  );
  r.post("/admin/orders/:id/reject", async (req, res) =>
    res.json(
      await s.closeOrder(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        key(req),
        parse(c.reason, req.body),
      ),
    ),
  );
  r.post("/admin/orders/:id/cancel-review", async (req, res) =>
    res.json(
      await s.closeOrder(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        key(req),
        parse(c.cancelReview, req.body),
        true,
      ),
    ),
  );
  r.post("/admin/orders/:id/payments/:paymentId/review", async (req, res) =>
    res.json(
      await s.reviewReceipt(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        parse(id, req.params.paymentId),
        key(req),
        parse(c.review, req.body),
      ),
    ),
  );
  for (const [path, action, schema] of [
    ["exceptions", "open", c.exception],
    ["settlements", "settle", c.settlement],
    ["resolve", "resolve", c.resolve],
  ] as const)
    r.post("/admin/orders/:id/" + path, async (req, res) =>
      res.json(
        await finance(
          pool,
          res.locals.identity,
          parse(id, req.params.id),
          key(req),
          action,
          parse(schema as z.ZodType, req.body),
        ),
      ),
    );
  r.get("/admin/payment-methods", async (req, res) => {
    parse(z.strictObject({}), req.query);
    const scope = await accessScope(
      pool,
      res.locals.identity,
      "payment-methods.write",
    );
    if (!scope.global && !scope.branchIds.length) throw forbidden();
    res.json({
      items: (
        await pool.query(
          "SELECT * FROM payment_methods WHERE $1::boolean OR branch_id=ANY($2::uuid[]) ORDER BY sort_order,id",
          [scope.global, scope.branchIds],
        )
      ).rows,
    });
  });
  for (const method of ["post", "put"] as const)
    r[method](
      method === "post"
        ? "/admin/payment-methods"
        : "/admin/payment-methods/:id",
      async (req, res) => {
        const v = parse(c.method, req.body),
          i = res.locals.identity as Identity,
          pid =
            method === "put"
              ? parse(id, (req.params as Record<string, string>).id)
              : null;
        const result = await transaction(pool, async (db) => {
          let old: any;
          if (pid) {
            old = (
              await db.query(
                "SELECT * FROM payment_methods WHERE id=$1 FOR UPDATE",
                [pid],
              )
            ).rows[0];
            if (!old) throw notFound();
          }
          await requirePermission(
            db,
            i,
            "payment-methods.write",
            v.branchId ? [v.branchId] : null,
          );
          if (old)
            await requirePermission(
              db,
              i,
              "payment-methods.write",
              old.branch_id ? [old.branch_id] : null,
            );
          const values = [
            v.branchId,
            v.name_ar,
            v.beneficiary,
            v.destination_number,
            v.instructions_ar,
            v.active,
          ];
          const row = (
            await db.query(
              pid
                ? "UPDATE payment_methods SET branch_id=$1,name_ar=$2,beneficiary=$3,destination_number=$4,instructions_ar=$5,active=$6 WHERE id=$7 RETURNING *"
                : "INSERT INTO payment_methods(branch_id,name_ar,beneficiary,destination_number,instructions_ar,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              pid ? [...values, pid] : values,
            )
          ).rows[0];
          await audit(
            db,
            res.locals.requestId,
            i.id,
            "payment_method.saved",
            "payment_method",
            row.id,
            { active: row.active },
            row.branch_id,
          );
          return row;
        });
        res.json(result);
      },
    );
  return r;
}
