import { Router } from "express";
import type pg from "pg";
import type { Security } from "../identity/security.js";
import {
  authenticate,
  accessScope,
  requirePermission,
  type Identity,
} from "../identity/access.js";
import { parse, forbidden } from "../http.js";
import { id, page } from "../catalog/contracts.js";
import { transaction } from "../db.js";
import * as c from "./contracts.js";
import { courierOnly, courierScope } from "./core.js";
import { assign, courierCommand, adjustCash } from "./service.js";
import { ledger, allocate, reverse } from "./ledger.js";
import { taskDetail } from "./views.js";
import { submitQuality, qualityList, updateQuality } from "./quality.js";
import { saveCourier } from "./management.js";
export function deliveryRouter(pool: pg.Pool, security: Security) {
  const r = Router();
  const key = (req: any) => req.get("Idempotency-Key") ?? "";
  r.use("/courier", authenticate(pool, security), (_req, res, next) => {
    courierOnly(res.locals.identity);
    next();
  });
  const admin = [
    "/admin/couriers",
    "/admin/settlements",
    "/admin/cash-remittances",
    "/admin/cash-collections",
    "/admin/customer-flags",
    "/admin/complaints",
    "/admin/reviews",
  ];
  r.use(admin, authenticate(pool, security), (_req, res, next) => {
    if (res.locals.identity.kind !== "staff") throw forbidden();
    next();
  });
  r.get("/courier/orders", async (req, res) => {
    const q = parse(page, req.query),
      i = res.locals.identity;
    const rows = (
      await pool.query(
        `SELECT o.id,o.order_number,o.status,o.version,o.payment_kind,b.name_ar branch_name,a.assigned_at FROM orders o JOIN order_assignments a ON a.order_id=o.id JOIN branches b ON b.id=o.branch_id WHERE a.courier_id=$1 AND a.ended_at IS NULL AND EXISTS(SELECT 1 FROM courier_branches cb WHERE cb.courier_id=$1 AND cb.branch_id=o.branch_id) AND ($2::uuid IS NULL OR o.id>$2) ORDER BY o.id LIMIT $3`,
        [i.id, q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json({
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      source: "backend",
    });
  });
  const read = async (fn: (db: pg.PoolClient) => Promise<any>) =>
    transaction(pool, async (db) => {
      await db.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      return fn(db);
    });
  r.get("/courier/orders/:id", async (req, res) =>
    res.json(
      await read((db) =>
        taskDetail(db, res.locals.identity, parse(id, req.params.id)),
      ),
    ),
  );
  for (const [path, action, schema] of [
    ["start", "start", c.start],
    ["deliver", "deliver", c.deliver],
    ["cash-collections", "collect", c.collect],
    ["cash-exceptions", "exception", c.cashException],
  ] as const)
    r.post("/courier/orders/:id/" + path, async (req, res) =>
      res.json(
        await courierCommand(
          pool,
          res.locals.identity,
          parse(id, req.params.id),
          key(req),
          action,
          parse(schema as any, req.body),
        ),
      ),
    );
  // Explicit authentication on shared order prefixes; never infer kind from URL casing.
  r.post(
    "/admin/orders/:id/assign",
    authenticate(pool, security),
    async (req, res) => {
      if (res.locals.identity.kind !== "staff") throw forbidden();
      res.json(
        await assign(
          pool,
          res.locals.identity,
          parse(id, req.params.id),
          key(req),
          parse(c.assign, req.body),
        ),
      );
    },
  );
  for (const [path, cash] of [
    ["earnings", false],
    ["cash-balance", true],
  ] as const) {
    r.get("/courier/" + path, async (req, res) =>
      res.json(
        await read((db) =>
          ledger(db, res.locals.identity, res.locals.identity.id, cash),
        ),
      ),
    );
    r.get("/admin/couriers/:id/" + path, async (req, res) =>
      res.json(
        await read((db) =>
          ledger(db, res.locals.identity, parse(id, req.params.id), cash),
        ),
      ),
    );
  }
  for (const [path, cash] of [
    ["settlements", false],
    ["cash-remittances", true],
  ] as const) {
    r.post("/admin/" + path, async (req, res) =>
      res.json(
        await allocate(
          pool,
          res.locals.identity,
          key(req),
          parse(c.allocation, req.body),
          cash,
        ),
      ),
    );
    r.post("/admin/" + path + "/:id/reversals", async (req, res) =>
      res.json(
        await reverse(
          pool,
          res.locals.identity,
          parse(id, req.params.id),
          key(req),
          parse(c.reverse, req.body),
          cash,
        ),
      ),
    );
  }
  r.post("/admin/cash-collections/:id/adjustments", async (req, res) =>
    res.json(
      await adjustCash(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        key(req),
        parse(c.adjust, req.body),
      ),
    ),
  );
  r.get("/admin/couriers", async (req, res) => {
    const q = parse(page, req.query),
      i = res.locals.identity,
      s = await accessScope(pool, i, "couriers.manage");
    if (!s.global && !s.branchIds.length) throw forbidden();
    const rows = (
      await pool.query(
        `SELECT u.id,u.name_ar,u.phone_e164,u.status,p.active,p.commission_bps,coalesce((SELECT jsonb_agg(cb.branch_id ORDER BY cb.branch_id) FROM courier_branches cb WHERE cb.courier_id=u.id),'[]') branch_ids FROM users u JOIN courier_profiles p ON p.user_id=u.id WHERE ($1::boolean OR (EXISTS(SELECT 1 FROM courier_branches cb WHERE cb.courier_id=u.id) AND NOT EXISTS(SELECT 1 FROM courier_branches cb WHERE cb.courier_id=u.id AND NOT(cb.branch_id=ANY($2::uuid[]))))) AND ($3::uuid IS NULL OR u.id>$3) ORDER BY u.id LIMIT $4`,
        [s.global, s.branchIds, q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json({
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      source: "backend",
    });
  });
  r.get("/admin/couriers/ledger-options", async (req, res) => {
    const { z } = await import("zod");
    const q = parse(
        z.strictObject({ kind: z.enum(["cash", "commission"]) }),
        req.query,
      ),
      permission = q.kind === "cash" ? "cash.remit" : "commissions.settle",
      i = res.locals.identity,
      s = await accessScope(pool, i, permission);
    if (!s.global && !s.branchIds.length) throw forbidden();
    const rows = (
      await pool.query(
        "SELECT u.id,u.name_ar FROM users u JOIN courier_profiles p ON p.user_id=u.id WHERE $1::boolean OR (EXISTS(SELECT 1 FROM courier_branches b WHERE b.courier_id=u.id) AND NOT EXISTS(SELECT 1 FROM (SELECT branch_id FROM courier_branches WHERE courier_id=u.id UNION SELECT o.branch_id FROM order_assignments a JOIN orders o ON o.id=a.order_id WHERE a.courier_id=u.id) b WHERE NOT(b.branch_id=ANY($2::uuid[])))) ORDER BY u.id LIMIT 100",
        [s.global, s.branchIds],
      )
    ).rows;
    res.json({ items: rows });
  });
  r.post("/admin/couriers", async (req, res) =>
    res.json(
      await saveCourier(
        pool,
        res.locals.identity,
        null,
        key(req),
        parse(c.profile, req.body),
      ),
    ),
  );
  r.post("/admin/couriers/:id/configure", async (req, res) =>
    res.json(
      await saveCourier(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        key(req),
        parse(c.configure, req.body),
      ),
    ),
  );
  r.get("/admin/couriers/:id/configuration-history", async (req, res) => {
    const courierId = parse(id, req.params.id),
      q = parse(page, req.query);
    res.json(
      await read(async (db) => {
        await courierScope(
          db,
          res.locals.identity,
          courierId,
          "couriers.manage",
        );
        const rows = (
          await db.query(
            `SELECT id,actor_id,(SELECT name_ar FROM users WHERE id=audit_logs.actor_id) actor_name,created_at,after_redacted->'commissionBps' commission_bps,after_redacted->'active' active,jsonb_array_length(after_redacted->'branchIds') branch_count FROM audit_logs WHERE entity_type='courier' AND entity_id=$1 AND action='courier.configured' AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM audit_logs WHERE id=$2 AND entity_type='courier' AND entity_id=$1 AND action='courier.configured')) ORDER BY created_at DESC,id DESC LIMIT $3`,
            [courierId, q.cursor ?? null, q.limit + 1],
          )
        ).rows;
        return {
          source: "backend",
          items: rows.slice(0, q.limit),
          nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
        };
      }),
    );
  });
  // Assignment candidates need orders.assign, independently of account-management authority.
  r.get(
    "/admin/orders/:id/courier-options",
    authenticate(pool, security),
    async (req, res) => {
      const { order, scopes } = await import("../orders/core.js");
      const o = await order(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        "orders.assign",
      );
      await requirePermission(
        pool,
        res.locals.identity,
        "orders.assign",
        scopes(o),
      );
      res.json({
        items: (
          await pool.query(
            "SELECT u.id,u.name_ar,p.commission_bps FROM users u JOIN courier_profiles p ON p.user_id=u.id JOIN courier_branches b ON b.courier_id=u.id WHERE u.kind='courier' AND u.status='active' AND p.active AND p.commission_bps IS NOT NULL AND b.branch_id=$1 ORDER BY u.id",
            [o.branch_id],
          )
        ).rows,
      });
    },
  );
  for (const [kind, path, schema] of [
    ["review", "review", c.review],
    ["complaint", "complaints", c.complaint],
  ] as const)
    r.post(
      "/orders/:id/" + path,
      authenticate(pool, security),
      async (req, res) =>
        res.json(
          await submitQuality(
            pool,
            res.locals.identity,
            parse(id, req.params.id),
            key(req),
            kind,
            parse(schema as any, req.body),
          ),
        ),
    );
  r.post("/courier/orders/:id/customer-flags", async (req, res) =>
    res.json(
      await submitQuality(
        pool,
        res.locals.identity,
        parse(id, req.params.id),
        key(req),
        "flag",
        parse(c.flag, req.body),
      ),
    ),
  );
  r.post("/admin/customer-flags", async (req, res) => {
    const v = parse(c.adminFlag, req.body);
    res.json(
      await submitQuality(
        pool,
        res.locals.identity,
        v.orderId,
        key(req),
        "flag",
        v,
      ),
    );
  });
  for (const [kind, path, schema] of [
    ["flag", "customer-flags", c.flagUpdate],
    ["complaint", "complaints", c.complaintUpdate],
  ] as const) {
    r.get("/admin/" + path, async (req, res) => {
      const q = parse(page, req.query);
      res.json(
        await read((db) =>
          qualityList(db, res.locals.identity, kind, q.cursor ?? null, q.limit),
        ),
      );
    });
    r.post("/admin/" + path + "/:id/review", async (req, res) =>
      res.json(
        await updateQuality(
          pool,
          res.locals.identity,
          parse(id, req.params.id),
          key(req),
          kind,
          parse(schema as any, req.body),
        ),
      ),
    );
  }
  r.get("/admin/reviews", async (req, res) => {
    const q = parse(page, req.query);
    res.json(
      await read((db) =>
        qualityList(
          db,
          res.locals.identity,
          "review",
          q.cursor ?? null,
          q.limit,
        ),
      ),
    );
  });
  return r;
}
