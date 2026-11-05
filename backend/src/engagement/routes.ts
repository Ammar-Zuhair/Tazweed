import { Router } from "express";
import type pg from "pg";
import type { Config } from "../config.js";
import type { Security } from "../identity/security.js";
import { authenticate, requirePermission } from "../identity/access.js";
import { parse, forbidden } from "../http.js";
import {
  configuration,
  saveMaintenance,
  saveRelease,
} from "./configuration.js";
import { deployment } from "./provider.js";
import {
  registerToken,
  revokeTokens,
  inbox,
  readNotice,
  campaignCommand,
  getNotice,
} from "./service.js";
import * as c from "./contracts.js";
export function engagementRouter(
  pool: pg.Pool,
  security: Security,
  config: Config,
) {
  const r = Router();
  r.get("/public/config", async (req, res) =>
    res.json(
      await configuration(pool, config, parse(c.publicConfig, req.query)),
    ),
  );
  r.use(
    [
      "/devices",
      "/notifications",
      "/admin/campaigns",
      "/admin/customer-maintenance",
      "/admin/app-releases",
    ],
    authenticate(pool, security),
  );
  r.use(
    ["/admin/campaigns", "/admin/customer-maintenance", "/admin/app-releases"],
    (_req, res, next) => {
      if (res.locals.identity.kind !== "staff") throw forbidden();
      next();
    },
  );
  r.post("/devices/push-tokens", async (req, res) =>
    res.json(
      await registerToken(
        pool,
        config,
        res.locals.identity,
        parse(c.token, req.body),
      ),
    ),
  );
  r.delete("/devices/push-tokens", async (req, res) => {
    parse(c.cancel.pick({}).strict(), req.body ?? {});
    res.json(await revokeTokens(pool, res.locals.identity));
  });
  r.get("/notifications", async (req, res) =>
    res.json(await inbox(pool, res.locals.identity, parse(c.page, req.query))),
  );
  r.get("/notifications/:id", async (req, res) =>
    res.json(
      await getNotice(pool, res.locals.identity, parse(c.id, req.params.id)),
    ),
  );
  r.patch("/notifications/:id/read", async (req, res) => {
    parse(c.cancel.pick({}).strict(), req.body ?? {});
    res.json(
      await readNotice(pool, res.locals.identity, parse(c.id, req.params.id)),
    );
  });
  r.get("/admin/customer-maintenance", async (_req, res) => {
    await requirePermission(
      pool,
      res.locals.identity,
      "maintenance.write",
      null,
    );
    res.json(
      (
        await pool.query(
          "SELECT enabled,message_ar,version,updated_at FROM customer_maintenance WHERE singleton",
        )
      ).rows[0],
    );
  });
  r.put("/admin/customer-maintenance", async (req, res) =>
    res.json(
      await saveMaintenance(
        pool,
        res.locals.identity,
        parse(c.maintenance, req.body),
      ),
    ),
  );
  r.get("/admin/app-releases", async (_req, res) => {
    await requirePermission(pool, res.locals.identity, "releases.write", null);
    res.json({
      environment: deployment(config),
      items: (
        await pool.query(
          "SELECT id,app,platform,environment,minimum_build::int,latest_build::int,latest_version,store_url,message_ar,version,binary_confirmed FROM app_releases WHERE environment=$1 ORDER BY app,platform",
          [deployment(config)],
        )
      ).rows,
    });
  });
  r.put("/admin/app-releases", async (req, res) =>
    res.json(
      await saveRelease(
        pool,
        config,
        res.locals.identity,
        parse(c.release, req.body),
      ),
    ),
  );
  r.get("/admin/campaigns", async (req, res) => {
    await requirePermission(
      pool,
      res.locals.identity,
      "notifications.broadcast",
      null,
    );
    const q = parse(c.page, req.query);
    const rows = (
      await pool.query(
        "SELECT id,title_ar,body_ar,audience,status,scheduled_at,version,error_code,created_at,finished_at FROM notification_campaigns WHERE environment=$3 AND ($1::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM notification_campaigns WHERE id=$1)) ORDER BY created_at DESC,id DESC LIMIT $2",
        [q.cursor ?? null, q.limit + 1, deployment(config)],
      )
    ).rows;
    res.json({
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
    });
  });
  r.post("/admin/campaigns", async (req, res) =>
    res.json(
      await campaignCommand(
        pool,
        config,
        res.locals.identity,
        req.get("Idempotency-Key") ?? "",
        "create",
        null,
        parse(c.campaign, req.body),
      ),
    ),
  );
  for (const action of ["schedule", "cancel"] as const)
    r.post("/admin/campaigns/:id/" + action, async (req, res) =>
      res.json(
        await campaignCommand(
          pool,
          config,
          res.locals.identity,
          req.get("Idempotency-Key") ?? "",
          action,
          parse(c.id, req.params.id),
          parse(action === "schedule" ? c.schedule : c.cancel, req.body),
        ),
      ),
    );
  return r;
}
