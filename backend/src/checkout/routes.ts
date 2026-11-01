import { Router } from "express";
import type pg from "pg";
import type { Security } from "../identity/security.js";
import {
  authenticate,
  customerOnly,
  requirePermission,
  type Identity,
} from "../identity/access.js";
import { audit } from "../identity/audit.js";
import { transaction } from "../db.js";
import { ApiError, parse, notFound } from "../http.js";
import { id, page } from "../catalog/contracts.js";
import { z } from "zod";
import { promotion, preview } from "./contracts.js";
import { catalogContext, customerMaintenance, previewCart } from "./service.js";
import type { RoutingProvider } from "./routing.js";
export function checkoutRouter(
  pool: pg.Pool,
  security: Security,
  routing: RoutingProvider,
) {
  const r = Router(),
    pending = new Set<string>();
  r.get("/public/maps", (_req, res) =>
    res.json({
      engine: "maplibre-gl-js",
      styleUrl: "https://tiles.openfreemap.org/styles/liberty",
      attribution: [
        { label: "OpenFreeMap", url: "https://openfreemap.org/" },
        { label: "© OpenMapTiles", url: "https://www.openmaptiles.org/" },
        {
          label: "© OpenStreetMap contributors",
          url: "https://www.openstreetmap.org/copyright",
        },
      ],
      routing: routing.mode,
      source: "backend",
    }),
  );
  r.get("/delivery/catalog-context", async (req, res) => {
    const q = parse(z.strictObject({ governorateId: id }), req.query);
    await customerMaintenance(pool);
    res.json({
      ...(await catalogContext(pool, q.governorateId)),
      executionBranchId: null,
      source: "backend",
    });
  });
  r.get("/catalog/promotions", async (req, res) => {
    const q = parse(page.extend({ governorateId: id }), req.query);
    await customerMaintenance(pool);
    await catalogContext(pool, q.governorateId);
    const rows = (
      await pool.query(
        "SELECT id,name_ar,category_id,product_id,target,discount_kind,value::text,starts_at,ends_at FROM promotions WHERE active AND starts_at<=now() AND ends_at>now() AND (governorate_id IS NULL OR governorate_id=$1) AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
        [q.governorateId, q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json({
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      source: "backend",
    });
  });
  r.post(
    "/checkout/preview",
    authenticate(pool, security),
    async (req, res) => {
      const i = res.locals.identity as Identity;
      customerOnly(i);
      const v = parse(preview, req.body);
      if (pending.has(i.id) || pending.size >= 16)
        throw new ApiError(
          429,
          "PREVIEW_BUSY",
          "انتظر انتهاء المعاينة الحالية ثم حاول مجددًا",
        );
      pending.add(i.id);
      try {
        res.json(await previewCart(pool, routing, i.id, v));
      } finally {
        pending.delete(i.id);
      }
    },
  );
  r.use("/admin/promotions", authenticate(pool, security));
  r.get("/admin/promotions", async (req, res) => {
    await requirePermission(
      pool,
      res.locals.identity,
      "promotions.write",
      null,
    );
    const q = parse(page, req.query),
      rows = (
        await pool.query(
          "SELECT * FROM promotions WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2",
          [q.cursor ?? null, q.limit + 1],
        )
      ).rows;
    res.json({
      items: rows.slice(0, q.limit),
      nextCursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
    });
  });
  for (const method of ["post", "put"] as const)
    r[method](
      method === "post" ? "/admin/promotions" : "/admin/promotions/:id",
      async (req, res) => {
        const i = res.locals.identity as Identity,
          v = parse(promotion, req.body),
          pid =
            method === "put"
              ? parse(id, (req.params as Record<string, string>).id)
              : null;
        const row = await transaction(pool, async (db) => {
          await requirePermission(db, i, "promotions.write", null);
          if (
            v.governorate_id &&
            !(
              await db.query("SELECT 1 FROM governorates WHERE id=$1", [
                v.governorate_id,
              ])
            ).rowCount
          )
            throw notFound();
          if (
            v.category_id &&
            !(
              await db.query("SELECT 1 FROM categories WHERE id=$1", [
                v.category_id,
              ])
            ).rowCount
          )
            throw notFound();
          if (
            v.product_id &&
            !(
              await db.query("SELECT 1 FROM products WHERE id=$1", [
                v.product_id,
              ])
            ).rowCount
          )
            throw notFound();
          const values = [
            v.name_ar,
            v.governorate_id,
            v.category_id,
            v.product_id,
            v.target,
            v.discount_kind,
            v.value,
            v.starts_at,
            v.ends_at,
            v.active,
          ];
          const result = pid
            ? await db.query(
                "UPDATE promotions SET name_ar=$1,governorate_id=$2,category_id=$3,product_id=$4,target=$5,discount_kind=$6,value=$7,starts_at=$8,ends_at=$9,active=$10 WHERE id=$11 RETURNING *",
                [...values, pid],
              )
            : await db.query(
                "INSERT INTO promotions(name_ar,governorate_id,category_id,product_id,target,discount_kind,value,starts_at,ends_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
                values,
              );
          const p = result.rows[0];
          if (!p) throw notFound();
          await audit(
            db,
            res.locals.requestId,
            i.id,
            "promotion.saved",
            "promotion",
            p.id,
            { active: p.active },
          );
          return p;
        });
        res.status(pid ? 200 : 201).json(row);
      },
    );
  return r;
}
