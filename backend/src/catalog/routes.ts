import { Router } from "express";
import { z } from "zod";
import type pg from "pg";
import type { Security } from "../identity/security.js";
import {
  authenticate,
  requirePermission,
  accessScope,
  type Identity,
} from "../identity/access.js";
import { audit } from "../identity/audit.js";
import { transaction } from "../db.js";
import { ApiError, parse, notFound, forbidden } from "../http.js";
import * as c from "./contracts.js";
import { changeStock, transferStock } from "./stock.js";
export const catalogSpecs = {
  governorates: { schema: c.governorate, permission: "branches.write" },
  branches: { schema: c.branch, permission: "branches.write" },
  categories: { schema: c.category, permission: "catalog.write" },
  attributes: { schema: c.attribute, permission: "attributes.write" },
  "attribute-values": { schema: c.value, permission: "attributes.write" },
};
const tableName = (s: string) =>
  s === "attribute-values" ? "attribute_values" : s;
export function catalogRouter(pool: pg.Pool, security: Security) {
  const r = Router();
  r.get("/public/governorates", async (req, res) => {
    const q = parse(c.page, req.query);
    const rows = (
      await pool.query(
        "SELECT id,name_ar,catalog_branch_id FROM governorates WHERE active AND ($1::uuid IS NULL OR (sort_order,id)>(SELECT sort_order,id FROM governorates WHERE id=$1)) ORDER BY sort_order,id LIMIT $2",
        [q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json(paginate(rows, q.limit));
  });
  r.get("/public/branches", async (req, res) => {
    const q = parse(c.page.extend({ governorateId: c.id }), req.query);
    const rows = (
      await pool.query(
        "SELECT id,name_ar,governorate_id FROM branches WHERE active AND governorate_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
        [q.governorateId, q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json(paginate(rows, q.limit));
  });
  r.use("/catalog", async (_req, _res, next) => {
    const m = (
      await pool.query("SELECT enabled,message_ar FROM customer_maintenance")
    ).rows[0];
    if (m?.enabled) throw new ApiError(503, "MAINTENANCE", m.message_ar);
    next();
  });
  r.get("/catalog/categories", async (req, res) => {
    const q = parse(c.page, req.query);
    const rows = (
      await pool.query(
        `SELECT c.id,c.name_ar,c.parent_id,c.sort_order,m.id AS image_id FROM categories c LEFT JOIN media_objects m ON m.id=c.image_id AND m.status='verified' AND m.visibility='public' WHERE c.active AND ($1::uuid IS NULL OR (c.sort_order,c.id)>(SELECT sort_order,id FROM categories WHERE id=$1)) ORDER BY c.sort_order,c.id LIMIT $2`,
        [q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json(paginate(rows, q.limit));
  });
  r.get("/catalog/categories/:id/filters", async (req, res) => {
    const id = parse(c.id, req.params.id);
    if (
      !(
        await pool.query("SELECT 1 FROM categories WHERE id=$1 AND active", [
          id,
        ])
      ).rowCount
    )
      throw notFound();
    const items = (
      await pool.query(
        `SELECT a.id,a.code,a.name_ar,ca.required,ca.sort_order,coalesce(json_agg(json_build_object('id',v.id,'label',v.value_ar) ORDER BY v.sort_order,v.id) FILTER(WHERE v.id IS NOT NULL),'[]') AS values FROM category_attributes ca JOIN attributes a ON a.id=ca.attribute_id AND a.active LEFT JOIN attribute_values v ON v.attribute_id=a.id AND v.active WHERE ca.category_id=$1 AND ca.filterable GROUP BY a.id,ca.required,ca.sort_order ORDER BY ca.sort_order,a.id`,
        [id],
      )
    ).rows;
    res.json({ items });
  });
  async function catalogBranch(governorateId: string) {
    const row = (
      await pool.query(
        `SELECT b.id FROM governorates g JOIN branches b ON b.id=g.catalog_branch_id AND b.governorate_id=g.id WHERE g.id=$1 AND g.active AND b.active`,
        [governorateId],
      )
    ).rows[0];
    if (!row)
      throw new ApiError(
        409,
        "CATALOG_UNCONFIGURED",
        "لم يحدد فرع كتالوج نشط لهذه المحافظة",
      );
    return row.id as string;
  }
  async function products(
    branch: string,
    query: z.infer<typeof c.listProducts>,
    productId?: string,
  ) {
    const filters = query.attributeValueIds
      ? query.attributeValueIds.split(",").map((v) => parse(c.id, v))
      : [];
    if (filters.length && !query.categoryId)
      throw new ApiError(422, "FILTER_CATEGORY_REQUIRED", "اختر قسمًا للفلاتر");
    if (filters.length) {
      const valid = await pool.query(
        `SELECT count(*)::int n FROM attribute_values v JOIN attributes a ON a.id=v.attribute_id AND a.active JOIN category_attributes ca ON ca.attribute_id=a.id AND ca.category_id=$1 AND ca.filterable WHERE v.id=ANY($2::uuid[]) AND v.active`,
        [query.categoryId, filters],
      );
      if (valid.rows[0].n !== new Set(filters).size)
        throw new ApiError(
          422,
          "INVALID_FILTER",
          "القيمة لا تخص فلاتر هذا القسم",
        );
    }
    const rows = (
      await pool.query(
        `SELECT p.id,p.sku,p.category_id,p.name_ar,p.description_ar,p.origin_country,p.version,
   coalesce((SELECT json_agg(json_build_object('id',u.id,'kind',u.unit_kind,'pieces_per_unit',u.pieces_per_unit,'price_yer',coalesce(bp.price_yer,u.price_yer)::text,'available',coalesce(s.sellable AND s.on_hand-s.reserved>=u.pieces_per_unit,false)) ORDER BY u.unit_kind) FROM product_units u LEFT JOIN branch_unit_prices bp ON bp.unit_id=u.id AND bp.branch_id=$1 AND bp.active LEFT JOIN stock_levels s ON s.branch_id=$1 AND s.product_id=p.id WHERE u.product_id=p.id AND u.active AND u.archived_at IS NULL),'[]') AS units,
   coalesce((SELECT json_agg(json_build_object('attribute_id',a.id,'name',a.name_ar,'value',v.value_ar,'value_id',v.id)) FROM product_attribute_values pa JOIN attributes a ON a.id=pa.attribute_id AND a.active JOIN attribute_values v ON v.id=pa.value_id AND v.active WHERE pa.product_id=p.id),'[]') AS attributes,
   coalesce((SELECT json_agg(json_build_object('id',m.id,'width',m.width,'height',m.height) ORDER BY pi.sort_order) FROM product_images pi JOIN media_objects m ON m.id=pi.media_id AND m.visibility='public' AND m.status='verified' WHERE pi.product_id=p.id),'[]') AS images
   FROM products p JOIN categories c ON c.id=p.category_id AND c.active WHERE p.active AND ($2::uuid IS NULL OR p.category_id=$2) AND ($3='' OR p.name_ar ILIKE '%'||$3||'%' OR p.sku ILIKE '%'||$3||'%') AND ($4::uuid IS NULL OR p.id>$4) AND ($5::uuid IS NULL OR p.id=$5)
   AND NOT EXISTS(SELECT 1 FROM category_attributes ca JOIN attributes a ON a.id=ca.attribute_id WHERE ca.category_id=p.category_id AND ca.required AND (NOT a.active OR NOT EXISTS(SELECT 1 FROM product_attribute_values pa JOIN attribute_values v ON v.id=pa.value_id AND v.active WHERE pa.product_id=p.id AND pa.attribute_id=ca.attribute_id)))
   AND NOT EXISTS(SELECT DISTINCT v.attribute_id FROM attribute_values v WHERE v.id=ANY($6::uuid[]) AND NOT EXISTS(SELECT 1 FROM product_attribute_values pa WHERE pa.product_id=p.id AND pa.attribute_id=v.attribute_id AND pa.value_id=ANY($6::uuid[])))
   ORDER BY p.id LIMIT $7`,
        [
          branch,
          query.categoryId ?? null,
          query.search,
          query.cursor ?? null,
          productId ?? null,
          filters,
          query.limit + 1,
        ],
      )
    ).rows;
    return rows;
  }
  r.get("/catalog/products", async (req, res) => {
    const q = parse(c.listProducts, req.query),
      branch = await catalogBranch(q.governorateId);
    res.json({
      ...paginate(await products(branch, q), q.limit),
      catalogBranchId: branch,
      source: "backend",
    });
  });
  r.get("/catalog/products/:id", async (req, res) => {
    const id = parse(c.id, req.params.id),
      q = parse(c.listProducts, req.query),
      branch = await catalogBranch(q.governorateId),
      rows = await products(branch, q, id);
    if (!rows[0]) throw notFound();
    res.json({ ...rows[0], catalogBranchId: branch, source: "backend" });
  });
  r.use("/admin", authenticate(pool, security));
  for (const [name, spec] of Object.entries(catalogSpecs)) {
    const table = tableName(name);
    r.get("/admin/" + name, async (req, res) => {
      const i = res.locals.identity as Identity,
        q = parse(c.page, req.query);
      if (["categories", "attributes", "attribute-values"].includes(name))
        await readMetadata(pool, i);
      else await requirePermission(pool, i, spec.permission, null);
      const rows = (
        await pool.query(
          `SELECT * FROM ${table} WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2`,
          [q.cursor ?? null, q.limit + 1],
        )
      ).rows;
      res.json(paginate(rows, q.limit));
    });
    for (const method of ["post", "put"] as const)
      r[method](
        "/admin/" + name + (method === "put" ? "/:id" : ""),
        async (req, res) => {
          const i = res.locals.identity as Identity,
            v = parse(spec.schema as z.ZodType<Record<string, any>>, req.body),
            id = method === "put" ? parse(c.id, req.params.id) : null;
          const result = await transaction(pool, async (db) => {
            await db.query("SELECT pg_advisory_xact_lock(606,1)");
            await requirePermission(db, i, spec.permission, null);
            if (
              id &&
              !(
                await db.query(
                  `SELECT 1 FROM ${table} WHERE id=$1 FOR UPDATE`,
                  [id],
                )
              ).rowCount
            )
              throw notFound();
            if (name === "categories" && v.parent_id) {
              if (id) {
                const cycle = await db.query(
                  "WITH RECURSIVE parents AS(SELECT id,parent_id FROM categories WHERE id=$1 UNION SELECT c.id,c.parent_id FROM categories c JOIN parents p ON c.id=p.parent_id) SELECT 1 FROM parents WHERE id=$2",
                  [v.parent_id, id],
                );
                if (cycle.rowCount)
                  throw new ApiError(409, "CATEGORY_CYCLE", "دورة في الأقسام");
              }
            }
            if (name === "categories" && v.image_id)
              await publicImage(db, v.image_id, "category");
            const keys = Object.keys(v),
              values = Object.values(v);
            const row = id
              ? (
                  await db.query(
                    `UPDATE ${table} SET ${keys.map((k, n) => `${k}=$${n + 2}`).join(",")} WHERE id=$1 RETURNING *`,
                    [id, ...values],
                  )
                ).rows[0]
              : (
                  await db.query(
                    `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, n) => "$" + (n + 1)).join(",")}) RETURNING *`,
                    values,
                  )
                ).rows[0];
            await audit(
              db,
              res.locals.requestId,
              i.id,
              "catalog." + name + "_saved",
              table,
              row.id,
            );
            return row;
          });
          res.status(method === "post" ? 201 : 200).json(result);
        },
      );
  }
  r.get("/admin/categories/:id/attributes", async (req, res) => {
    await readMetadata(pool, res.locals.identity);
    res.json({
      items: (
        await pool.query(
          "SELECT * FROM category_attributes WHERE category_id=$1 ORDER BY sort_order,attribute_id",
          [parse(c.id, req.params.id)],
        )
      ).rows,
    });
  });
  r.put("/admin/categories/:id/attributes", async (req, res) => {
    const id = parse(c.id, req.params.id),
      v = parse(c.categoryAttributes, req.body),
      i = res.locals.identity as Identity;
    if (new Set(v.items.map((x) => x.attribute_id)).size !== v.items.length)
      throw new ApiError(422, "DUPLICATE_ATTRIBUTE", "خاصية مكررة");
    await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(606,1)");
      await requirePermission(db, i, "attributes.write", null);
      if (
        !(await db.query("SELECT 1 FROM categories WHERE id=$1", [id])).rowCount
      )
        throw notFound();
      // Preserve referenced links: removing one needs explicit product remediation first.
      const old = (
        await db.query(
          "SELECT attribute_id FROM category_attributes WHERE category_id=$1",
          [id],
        )
      ).rows;
      for (const item of old)
        if (!v.items.some((x) => x.attribute_id === item.attribute_id))
          await db.query(
            "DELETE FROM category_attributes WHERE category_id=$1 AND attribute_id=$2",
            [id, item.attribute_id],
          );
      for (const item of v.items) {
        if (
          !(
            await db.query("SELECT 1 FROM attributes WHERE id=$1 AND active", [
              item.attribute_id,
            ])
          ).rowCount
        )
          throw new ApiError(422, "INACTIVE_ATTRIBUTE", "خاصية غير نشطة");
        if (
          item.required &&
          (
            await db.query(
              `SELECT 1 FROM products p WHERE p.category_id=$1 AND p.active AND NOT EXISTS(SELECT 1 FROM product_attribute_values pa JOIN attribute_values av ON av.id=pa.value_id AND av.active WHERE pa.product_id=p.id AND pa.attribute_id=$2) LIMIT 1`,
              [id, item.attribute_id],
            )
          ).rowCount
        )
          throw new ApiError(
            409,
            "REQUIRED_VALUES_MISSING",
            "أكمل قيم المنتجات أولًا",
          );
        await db.query(
          `INSERT INTO category_attributes(category_id,attribute_id,required,filterable,sort_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(category_id,attribute_id) DO UPDATE SET required=excluded.required,filterable=excluded.filterable,sort_order=excluded.sort_order`,
          [
            id,
            item.attribute_id,
            item.required,
            item.filterable,
            item.sort_order,
          ],
        );
      }
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "catalog.category_attributes",
        "category",
        id,
      );
    });
    res.json({ ok: true });
  });
  r.put("/admin/governorates/:id/catalog-branch", async (req, res) => {
    const id = parse(c.id, req.params.id),
      v = parse(z.strictObject({ branchId: c.id.nullable() }), req.body);
    await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(606,1)");
      await requirePermission(db, res.locals.identity, "branches.write", null);
      if (
        !(
          await db.query(
            "UPDATE governorates SET catalog_branch_id=$2 WHERE id=$1 RETURNING id",
            [id, v.branchId],
          )
        ).rowCount
      )
        throw notFound();
      await audit(
        db,
        res.locals.requestId,
        res.locals.identity.id,
        "catalog.branch_selected",
        "governorate",
        id,
      );
    });
    res.json({ ok: true });
  });
  r.put("/admin/branches/:id/delivery-rule", async (req, res) => {
    const id = parse(c.id, req.params.id),
      v = parse(
        z.strictObject({
          base_yer: c.money,
          per_km_yer: c.money,
          max_distance_m: z.number().int().positive(),
        }),
        req.body,
      );
    await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(606,1)");
      await requirePermission(db, res.locals.identity, "branches.write", [id]);
      await db.query(
        "INSERT INTO delivery_rules(branch_id,base_yer,per_km_yer,max_distance_m) VALUES($1,$2,$3,$4) ON CONFLICT(branch_id) DO UPDATE SET base_yer=excluded.base_yer,per_km_yer=excluded.per_km_yer,max_distance_m=excluded.max_distance_m,version=delivery_rules.version+1",
        [id, v.base_yer, v.per_km_yer, v.max_distance_m],
      );
      await audit(
        db,
        res.locals.requestId,
        res.locals.identity.id,
        "catalog.delivery_rule",
        "branch",
        id,
        null,
        id,
      );
    });
    res.json({ ok: true });
  });
  r.patch("/admin/branches/:id/delivery-enabled", async (req, res) => {
    const id = parse(c.id, req.params.id),
      v = parse(z.strictObject({ enabled: z.boolean() }), req.body);
    await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(606,1)");
      await requirePermission(db, res.locals.identity, "branches.write", [id]);
      if (
        !(
          await db.query(
            "UPDATE branches SET delivery_enabled=$2 WHERE id=$1 RETURNING id",
            [id, v.enabled],
          )
        ).rowCount
      )
        throw notFound();
      await audit(
        db,
        res.locals.requestId,
        res.locals.identity.id,
        "catalog.delivery_enabled",
        "branch",
        id,
        { enabled: v.enabled },
        id,
      );
    });
    res.json({ ok: true });
  });
  r.get("/admin/attributes/:id/values", async (req, res) => {
    await requirePermission(
      pool,
      res.locals.identity,
      "attributes.write",
      null,
    );
    const q = parse(c.page, req.query);
    res.json(
      paginate(
        (
          await pool.query(
            "SELECT * FROM attribute_values WHERE attribute_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
            [parse(c.id, req.params.id), q.cursor ?? null, q.limit + 1],
          )
        ).rows,
        q.limit,
      ),
    );
  });
  r.post("/admin/attributes/:id/values", async (req, res) => {
    const id = parse(c.id, req.params.id),
      v = parse(c.value.omit({ attribute_id: true }), req.body);
    const row = await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(606,1)");
      await requirePermission(
        db,
        res.locals.identity,
        "attributes.write",
        null,
      );
      const row = (
        await db.query(
          "INSERT INTO attribute_values(attribute_id,value_ar,active,sort_order) VALUES($1,$2,$3,$4) RETURNING *",
          [id, v.value_ar, v.active, v.sort_order],
        )
      ).rows[0];
      await audit(
        db,
        res.locals.requestId,
        res.locals.identity.id,
        "catalog.attribute_value",
        "attribute_value",
        row.id,
      );
      return row;
    });
    res.status(201).json(row);
  });
  r.get("/admin/products", async (req, res) => {
    await requirePermission(pool, res.locals.identity, "catalog.write", null);
    const q = parse(c.page, req.query);
    const rows = (
      await pool.query(
        "SELECT * FROM products WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2",
        [q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json(paginate(rows, q.limit));
  });
  r.get("/admin/products/:id", async (req, res) => {
    await requirePermission(pool, res.locals.identity, "catalog.write", null);
    const id = parse(c.id, req.params.id),
      row = (await pool.query("SELECT * FROM products WHERE id=$1", [id]))
        .rows[0];
    if (!row) throw notFound();
    res.json({
      ...row,
      attributes: (
        await pool.query(
          "SELECT attribute_id,value_id FROM product_attribute_values WHERE product_id=$1",
          [id],
        )
      ).rows,
      image_ids: (
        await pool.query(
          "SELECT media_id FROM product_images WHERE product_id=$1 ORDER BY sort_order",
          [id],
        )
      ).rows.map((r) => r.media_id),
    });
  });
  for (const method of ["post", "put"] as const)
    r[method](
      "/admin/products" + (method === "put" ? "/:id" : ""),
      async (req, res) => {
        const i = res.locals.identity as Identity,
          v = parse(c.product, req.body),
          id = method === "put" ? parse(c.id, req.params.id) : null;
        const row = await transaction(pool, async (db) => {
          await db.query("SELECT pg_advisory_xact_lock(606,1)");
          await requirePermission(db, i, "catalog.write", null);
          if (
            new Set(v.attributes.map((a) => a.attribute_id)).size !==
              v.attributes.length ||
            new Set(v.image_ids).size !== v.image_ids.length
          )
            throw new ApiError(422, "DUPLICATE_VALUE", "قيمة أو صورة مكررة");
          if (
            !(
              await db.query(
                "SELECT 1 FROM categories WHERE id=$1 AND active",
                [v.category_id],
              )
            ).rowCount
          )
            throw new ApiError(422, "INACTIVE_CATEGORY", "القسم غير متاح");
          if (id) {
            const old = (
              await db.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [
                id,
              ])
            ).rows[0];
            if (!old) throw notFound();
            if (v.expected_version !== old.version)
              throw new ApiError(
                409,
                "VERSION_CONFLICT",
                "حدث المنتج قبل الحفظ",
              );
            if (v.sku !== old.sku)
              throw new ApiError(
                409,
                "SKU_IMMUTABLE",
                "SKU ثابت؛ أنشئ منتجًا جديدًا",
              );
            await db.query(
              "DELETE FROM product_attribute_values WHERE product_id=$1",
              [id],
            );
          }
          const rules = (
            await db.query(
              "SELECT ca.*,a.active FROM category_attributes ca JOIN attributes a ON a.id=ca.attribute_id WHERE ca.category_id=$1",
              [v.category_id],
            )
          ).rows;
          for (const a of v.attributes) {
            if (
              !rules.some(
                (r) => r.attribute_id === a.attribute_id && r.active,
              ) ||
              !(
                await db.query(
                  "SELECT 1 FROM attribute_values WHERE id=$1 AND attribute_id=$2 AND active",
                  [a.value_id, a.attribute_id],
                )
              ).rowCount
            )
              throw new ApiError(
                422,
                "INVALID_ATTRIBUTE_VALUE",
                "القيمة لا تخص خاصية نشطة مسموحة في القسم",
              );
          }
          if (
            v.active &&
            rules.some(
              (r) =>
                r.required &&
                (!r.active ||
                  !v.attributes.some((a) => a.attribute_id === r.attribute_id)),
            )
          )
            throw new ApiError(422, "REQUIRED_ATTRIBUTE", "خاصية مطلوبة ناقصة");
          const data = [
            v.sku,
            v.category_id,
            v.name_ar,
            v.description_ar,
            v.origin_country,
            v.active,
          ];
          const row = id
            ? (
                await db.query(
                  "UPDATE products SET sku=$1,category_id=$2,name_ar=$3,description_ar=$4,origin_country=$5,active=$6,version=version+1 WHERE id=$7 RETURNING *",
                  [...data, id],
                )
              ).rows[0]
            : (
                await db.query(
                  "INSERT INTO products(sku,category_id,name_ar,description_ar,origin_country,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
                  data,
                )
              ).rows[0];
          for (const a of v.attributes)
            await db.query(
              "INSERT INTO product_attribute_values(product_id,category_id,attribute_id,value_id) VALUES($1,$2,$3,$4)",
              [row.id, v.category_id, a.attribute_id, a.value_id],
            );
          await db.query("DELETE FROM product_images WHERE product_id=$1", [
            row.id,
          ]);
          for (const [n, image] of v.image_ids.entries()) {
            await publicImage(db, image, "product");
            await db.query(
              "INSERT INTO product_images(product_id,media_id,sort_order) VALUES($1,$2,$3)",
              [row.id, image, n],
            );
          }
          await audit(
            db,
            res.locals.requestId,
            i.id,
            "catalog.product_saved",
            "product",
            row.id,
          );
          return row;
        });
        res.status(method === "post" ? 201 : 200).json(row);
      },
    );
  r.get("/admin/products/:id/units", async (req, res) => {
    await requirePermission(pool, res.locals.identity, "catalog.write", null);
    res.json({
      items: (
        await pool.query(
          "SELECT id,product_id,unit_kind,pieces_per_unit,price_yer::text,active FROM product_units WHERE product_id=$1 ORDER BY id",
          [parse(c.id, req.params.id)],
        )
      ).rows,
    });
  });
  for (const method of ["post", "put"] as const)
    r[method](
      "/admin/products/:productId/units" + (method === "put" ? "/:id" : ""),
      async (req, res) => {
        const i = res.locals.identity as Identity,
          v = parse(c.unit, req.body),
          productId = parse(c.id, req.params.productId),
          id = method === "put" ? parse(c.id, req.params.id) : null;
        const row = await transaction(pool, async (db) => {
          await db.query("SELECT pg_advisory_xact_lock(606,1)");
          await requirePermission(db, i, "catalog.write", null);
          const row = id
            ? (
                await db.query(
                  "UPDATE product_units SET unit_kind=$3,pieces_per_unit=$4,price_yer=$5,active=$6,archived_at=CASE WHEN $6 THEN NULL ELSE now() END WHERE id=$1 AND product_id=$2 RETURNING *",
                  [
                    id,
                    productId,
                    v.unit_kind,
                    v.pieces_per_unit,
                    v.price_yer,
                    v.active,
                  ],
                )
              ).rows[0]
            : (
                await db.query(
                  "INSERT INTO product_units(product_id,unit_kind,pieces_per_unit,price_yer,active) VALUES($1,$2,$3,$4,$5) RETURNING *",
                  [
                    productId,
                    v.unit_kind,
                    v.pieces_per_unit,
                    v.price_yer,
                    v.active,
                  ],
                )
              ).rows[0];
          if (!row) throw notFound();
          await audit(
            db,
            res.locals.requestId,
            i.id,
            "catalog.unit_saved",
            "product_unit",
            row.id,
          );
          return row;
        });
        res.status(method === "post" ? 201 : 200).json(row);
      },
    );
  r.put(
    ["/admin/branch-prices", "/admin/branches/:branchId/unit-prices/:unitId"],
    async (req, res) => {
      const v = parse(
          c.price,
          req.params.branchId
            ? {
                ...req.body,
                branch_id: req.params.branchId,
                unit_id: req.params.unitId,
              }
            : req.body,
        ),
        i = res.locals.identity as Identity;
      await transaction(pool, async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(606,1)");
        await requirePermission(db, i, "catalog.write", [v.branch_id]);
        await db.query(
          "INSERT INTO branch_unit_prices(branch_id,unit_id,price_yer,active) VALUES($1,$2,$3,$4) ON CONFLICT(branch_id,unit_id) DO UPDATE SET price_yer=excluded.price_yer,active=excluded.active",
          [v.branch_id, v.unit_id, v.price_yer, v.active],
        );
        await audit(
          db,
          res.locals.requestId,
          i.id,
          "catalog.branch_price",
          "product_unit",
          v.unit_id,
          null,
          v.branch_id,
        );
      });
      res.json({ ok: true });
    },
  );
  r.get("/admin/branch-prices", async (req, res) => {
    const q = parse(c.page.extend({ branchId: c.id }), req.query);
    await requirePermission(pool, res.locals.identity, "catalog.write", [
      q.branchId,
    ]);
    res.json(
      paginate(
        (
          await pool.query(
            "SELECT unit_id AS id,unit_id,branch_id,price_yer::text,active FROM branch_unit_prices WHERE branch_id=$1 AND ($2::uuid IS NULL OR unit_id>$2) ORDER BY unit_id LIMIT $3",
            [q.branchId, q.cursor ?? null, q.limit + 1],
          )
        ).rows,
        q.limit,
      ),
    );
  });
  r.get("/admin/stock-products", async (req, res) => {
    const q = parse(
      c.page.extend({
        branchId: c.id,
        permission: z.enum([
          "inventory.adjust",
          "inventory.transfer",
          "catalog.write",
        ]),
      }),
      req.query,
    );
    await requirePermission(pool, res.locals.identity, q.permission, [
      q.branchId,
    ]);
    res.json(
      paginate(
        (
          await pool.query(
            `SELECT p.id,p.name_ar,p.sku,coalesce((SELECT json_agg(json_build_object('id',u.id,'unit_kind',u.unit_kind,'pieces_per_unit',u.pieces_per_unit)) FROM product_units u WHERE u.product_id=p.id AND u.active AND u.archived_at IS NULL),'[]') units FROM products p WHERE p.active AND ($1::uuid IS NULL OR p.id>$1) ORDER BY p.id LIMIT $2`,
            [q.cursor ?? null, q.limit + 1],
          )
        ).rows,
        q.limit,
      ),
    );
  });
  r.get("/admin/inventory", async (req, res) => {
    const q = parse(c.page.extend({ branchId: c.id }), req.query),
      i = res.locals.identity as Identity;
    await requirePermission(pool, i, "inventory.adjust", [q.branchId]);
    const rows = (
      await pool.query(
        "SELECT product_id AS id,branch_id,on_hand::text,reserved::text,(on_hand-reserved)::text AS free,version,sellable FROM stock_levels WHERE branch_id=$1 AND ($2::uuid IS NULL OR product_id>$2) ORDER BY product_id LIMIT $3",
        [q.branchId, q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json(paginate(rows, q.limit));
  });
  r.get("/admin/inventory/movements", async (req, res) => {
    const q = parse(c.page.extend({ branchId: c.id }), req.query);
    await requirePermission(pool, res.locals.identity, "inventory.adjust", [
      q.branchId,
    ]);
    const rows = (
      await pool.query(
        "SELECT * FROM stock_movements WHERE branch_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3",
        [q.branchId, q.cursor ?? null, q.limit + 1],
      )
    ).rows;
    res.json(paginate(rows, q.limit));
  });
  r.post(
    [
      "/admin/inventory/adjust",
      "/admin/inventory/adjustments",
      "/admin/inventory/receipts",
    ],
    async (req, res) =>
      res.json(
        await changeStock(
          pool,
          res.locals.identity,
          parse(
            c.stock,
            req.path.endsWith("/receipts")
              ? { ...req.body, reason: "receipt" }
              : req.body,
          ),
          req.get("Idempotency-Key") ?? "",
          res.locals.requestId,
        ),
      ),
  );
  r.post("/admin/inventory/transfers", async (req, res) =>
    res.json(
      await transferStock(
        pool,
        res.locals.identity,
        parse(c.transfer, req.body),
        req.get("Idempotency-Key") ?? "",
        res.locals.requestId,
      ),
    ),
  );
  return r;
}
export function paginate(rows: any[], limit: number) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1]?.id : null,
  };
}
async function publicImage(db: pg.PoolClient, id: string, purpose: string) {
  if (
    !(
      await db.query(
        `SELECT 1 FROM media_objects WHERE id=$1 AND visibility='public' AND status='verified' AND purpose=$2`,
        [id, purpose],
      )
    ).rowCount
  )
    throw new ApiError(
      422,
      "INVALID_IMAGE",
      "الصورة العامة غير متحقق منها أو لا تخص هذا الاستخدام",
    );
}

async function readMetadata(db: pg.Pool, i: Identity) {
  for (const permission of ["catalog.write", "attributes.write"])
    if ((await accessScope(db, i, permission)).global) return;
  throw forbidden();
}
