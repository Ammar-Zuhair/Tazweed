import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import * as c from "./contracts.js";
import { AuthService } from "./auth.js";
import {
  authenticate,
  customerOnly,
  requirePermission,
  accessScope,
  requestContext,
  type Identity,
} from "./access.js";
import { audit } from "./audit.js";
import { transaction } from "../db.js";
import { ApiError, forbidden, notFound, parse } from "../http.js";
import { hashPassword } from "./security.js";
export function identityRouter(auth: AuthService, pool: pg.Pool) {
  const router = Router();
  const context = (req: any, res: any) =>
    requestContext(req, res.locals.requestId);
  for (const [path, purpose, schema] of [
    ["/auth/register", "register", c.registerStart],
    ["/auth/login", "login", c.loginStart],
    ["/auth/password-reset", "reset_password", c.resetStart],
  ] as const) {
    router.post(path + "/start", async (req, res) => {
      const result = await auth.start(
        purpose,
        parse(schema as z.ZodType<any>, req.body),
        context(req, res),
      );
      res.status(202).json(result);
    });
    router.post(path + "/verify", async (req, res) => {
      const result = await auth.verify(
        purpose,
        parse(
          (purpose === "reset_password"
            ? c.resetVerify
            : c.proof) as z.ZodType<any>,
          req.body,
        ),
        context(req, res),
      );
      res.json(result);
    });
  }
  router.post("/auth/otp/resend", async (req, res) => {
    res
      .status(202)
      .json(await auth.resend(parse(c.resend, req.body), context(req, res)));
  });
  router.post("/auth/refresh", async (req, res) => {
    res.json(await auth.refresh(parse(c.refresh, req.body), context(req, res)));
  });
  router.use(
    /^\/(?:me(?=\/|$)|admin(?=\/|$)|auth\/logout$)/,
    authenticate(pool, auth.security),
  );
  router.post("/auth/logout", async (req, res) => {
    const i = res.locals.identity as Identity;
    parse(z.strictObject({}), req.body ?? {});
    await auth.logout(i.id, i.sessionId, context(req, res));
    res.status(204).end();
  });
  router.get("/me", async (_req, res) => {
    const i = res.locals.identity as Identity;
    res.json({
      id: i.id,
      name: i.name_ar,
      phone: i.phone_e164,
      kind: i.kind,
      app: i.app,
    });
  });
  router.patch("/me", async (req, res) => {
    const v = parse(c.profile, req.body),
      i = res.locals.identity as Identity;
    await transaction(pool, async (db) => {
      await db.query("UPDATE users SET name_ar=$2 WHERE id=$1", [i.id, v.name]);
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "identity.profile_updated",
        "user",
        i.id,
      );
    });
    res.json({ id: i.id, name: v.name });
  });
  router.get("/me/addresses", async (_req, res) => {
    const i = res.locals.identity as Identity;
    customerOnly(i);
    res.json({
      items: (
        await pool.query(
          `SELECT id,governorate_id,label,description,latitude::float8,longitude::float8,is_default FROM addresses WHERE user_id=$1 AND archived_at IS NULL ORDER BY is_default DESC,created_at,id LIMIT 100`,
          [i.id],
        )
      ).rows,
    });
  });
  for (const method of ["post", "patch"] as const)
    router[method](
      method === "post" ? "/me/addresses" : "/me/addresses/:id",
      async (req, res) => {
        const i = res.locals.identity as Identity;
        customerOnly(i);
        const input = parse(
            (method === "post" ? c.address : c.addressPatch) as z.ZodType<any>,
            req.body,
          ),
          id =
            method === "patch"
              ? parse(c.uuid, (req.params as Record<string, string>).id)
              : null;
        const row = await transaction(pool, async (db) => {
          await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [i.id]);
          let v: z.infer<typeof c.address>;
          if (id) {
            const old = (
              await db.query(
                "SELECT * FROM addresses WHERE id=$1 AND user_id=$2 AND archived_at IS NULL FOR UPDATE",
                [id, i.id],
              )
            ).rows[0];
            if (!old) throw notFound();
            v = parse(c.address, {
              governorateId: old.governorate_id,
              label: old.label,
              description: old.description ?? undefined,
              latitude: Number(old.latitude),
              longitude: Number(old.longitude),
              isDefault: old.is_default,
              ...input,
            });
          } else v = parse(c.address, input);
          if (
            !(
              await db.query(
                "SELECT 1 FROM governorates WHERE id=$1 AND active",
                [v.governorateId],
              )
            ).rowCount
          )
            throw new ApiError(422, "INVALID_REFERENCE", "المحافظة غير متاحة");
          if (v.isDefault)
            await db.query(
              "UPDATE addresses SET is_default=false WHERE user_id=$1 AND is_default",
              [i.id],
            );
          const data = [
            i.id,
            v.governorateId,
            v.label,
            v.description ?? null,
            v.latitude,
            v.longitude,
            v.isDefault,
          ];
          const row = id
            ? (
                await db.query(
                  "UPDATE addresses SET governorate_id=$2,label=$3,description=$4,latitude=$5,longitude=$6,is_default=$7 WHERE user_id=$1 AND id=$8 RETURNING id",
                  [...data, id],
                )
              ).rows[0]
            : (
                await db.query(
                  "INSERT INTO addresses(user_id,governorate_id,label,description,latitude,longitude,is_default) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
                  data,
                )
              ).rows[0];
          await audit(
            db,
            res.locals.requestId,
            i.id,
            "identity.address_saved",
            "address",
            row.id,
          );
          return row;
        });
        res.status(method === "post" ? 201 : 200).json(row);
      },
    );
  router.delete("/me/addresses/:id", async (req, res) => {
    const i = res.locals.identity as Identity;
    customerOnly(i);
    const id = parse(c.uuid, req.params.id);
    await transaction(pool, async (db) => {
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [i.id]);
      if (
        !(
          await db.query(
            "UPDATE addresses SET archived_at=now(),is_default=false WHERE id=$1 AND user_id=$2 AND archived_at IS NULL RETURNING id",
            [id, i.id],
          )
        ).rowCount
      )
        throw notFound();
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "identity.address_archived",
        "address",
        id,
      );
    });
    res.status(204).end();
  });
  router.get("/admin/access", async (_req, res) => {
    const i = res.locals.identity as Identity;
    if (i.kind !== "staff") throw forbidden();
    res.json({
      grants: (
        await pool.query(
          `SELECT g.id,g.role_id,g.branch_id,g.global_scope,array_agg(p.permission_code ORDER BY p.permission_code) AS permissions FROM staff_grants g JOIN role_permissions p ON p.role_id=g.role_id WHERE g.user_id=$1 GROUP BY g.id ORDER BY g.id`,
          [i.id],
        )
      ).rows,
    });
  });
  router.get("/admin/access/branches", async (req, res) => {
    const q = parse(
        z.strictObject({ permission: z.string().max(70) }),
        req.query,
      ),
      i = res.locals.identity as Identity;
    const scope = await accessScope(pool, i, q.permission);
    if (!scope.global && !scope.branchIds.length) throw forbidden();
    res.json({
      items: (
        await pool.query(
          "SELECT id,name_ar,governorate_id FROM branches WHERE ($1::boolean OR id=ANY($2::uuid[])) ORDER BY id LIMIT 100",
          [scope.global, scope.branchIds],
        )
      ).rows,
    });
  });
  router.get("/admin/permissions", async (_req, res) => {
    await requirePermission(pool, res.locals.identity, "staff.manage", null);
    res.json({
      items: (
        await pool.query("SELECT code,name_ar FROM permissions ORDER BY code")
      ).rows,
    });
  });
  router.get("/admin/roles", async (_req, res) => {
    await requirePermission(pool, res.locals.identity, "staff.manage", null);
    res.json({
      items: (
        await pool.query(
          `SELECT r.id,r.code,r.name_ar,coalesce(array_agg(p.permission_code ORDER BY p.permission_code) FILTER(WHERE p.permission_code IS NOT NULL),'{}') AS permissions FROM roles r LEFT JOIN role_permissions p ON p.role_id=r.id GROUP BY r.id ORDER BY r.code LIMIT 100`,
        )
      ).rows,
    });
  });
  for (const method of ["post", "put"] as const)
    router[method](
      method === "post" ? "/admin/roles" : "/admin/roles/:id",
      async (req, res) => {
        const i = res.locals.identity as Identity,
          v = parse(c.role, req.body),
          id =
            method === "put"
              ? parse(c.uuid, (req.params as Record<string, string>).id)
              : null;
        const row = await transaction(pool, async (db) => {
          // Serialize security administration and check permissions inside the write transaction.
          await db.query("SELECT pg_advisory_xact_lock(105,70)");
          await requirePermission(db, i, "staff.manage", null);
          if (
            (
              await db.query(
                "SELECT count(*)::int AS n FROM permissions WHERE code=ANY($1::text[])",
                [v.permissions],
              )
            ).rows[0].n !== v.permissions.length
          )
            throw new ApiError(422, "INVALID_PERMISSION", "صلاحية غير معروفة");
          if (id) {
            const old = (
              await db.query("SELECT code FROM roles WHERE id=$1 FOR UPDATE", [
                id,
              ])
            ).rows[0];
            if (!old) throw notFound();
            // Keep the bootstrap recovery role intact; create custom roles instead.
            if (old.code === "general_admin")
              throw new ApiError(
                409,
                "PROTECTED_ROLE",
                "دور المدير العام محمي",
              );
          }
          const r = id
            ? (
                await db.query(
                  "UPDATE roles SET code=$2,name_ar=$3 WHERE id=$1 RETURNING id",
                  [id, v.code, v.name],
                )
              ).rows[0]
            : (
                await db.query(
                  "INSERT INTO roles(code,name_ar) VALUES($1,$2) RETURNING id",
                  [v.code, v.name],
                )
              ).rows[0];
          if (id)
            await db.query("DELETE FROM role_permissions WHERE role_id=$1", [
              id,
            ]);
          for (const permission of v.permissions)
            await db.query(
              "INSERT INTO role_permissions(role_id,permission_code) VALUES($1,$2)",
              [r.id, permission],
            );
          await audit(
            db,
            res.locals.requestId,
            i.id,
            "access.role_saved",
            "role",
            r.id,
            { permissions: v.permissions },
          );
          return r;
        });
        res.status(method === "post" ? 201 : 200).json(row);
      },
    );
  router.delete("/admin/roles/:id", async (req, res) => {
    const i = res.locals.identity as Identity,
      id = parse(c.uuid, req.params.id);
    await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(105,70)");
      await requirePermission(db, i, "staff.manage", null);
      const r = (
        await db.query("SELECT code FROM roles WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!r) throw notFound();
      if (
        r.code === "general_admin" ||
        (
          await db.query(
            "SELECT 1 FROM staff_grants WHERE role_id=$1 LIMIT 1",
            [id],
          )
        ).rowCount
      )
        throw new ApiError(409, "ROLE_IN_USE", "الدور محمي أو مستخدم");
      await db.query("DELETE FROM role_permissions WHERE role_id=$1", [id]);
      await db.query("DELETE FROM roles WHERE id=$1", [id]);
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "access.role_deleted",
        "role",
        id,
      );
    });
    res.status(204).end();
  });
  router.get("/admin/staff", async (req, res) => {
    const i = res.locals.identity as Identity,
      q = parse(c.branchQuery, req.query);
    await requirePermission(
      pool,
      i,
      "staff.manage",
      q.branchId ? [q.branchId] : null,
    );
    // Branch viewers see only identities explicitly granted to that branch, never global staff.
    res.json({
      items: (
        await pool.query(
          `SELECT DISTINCT u.id,u.name_ar,u.kind,u.status FROM users u LEFT JOIN staff_grants g ON g.user_id=u.id
   WHERE u.kind IN ('staff','courier') AND ($1::uuid IS NULL OR g.branch_id=$1 OR EXISTS(SELECT 1 FROM courier_branches cb WHERE cb.courier_id=u.id AND cb.branch_id=$1))
   AND ($2::uuid IS NULL OR u.id>$2) ORDER BY u.id LIMIT $3`,
          [q.branchId ?? null, q.cursor ?? null, q.limit],
        )
      ).rows,
    });
  });
  router.post("/admin/staff", async (req, res) => {
    const i = res.locals.identity as Identity;
    await requirePermission(pool, i, "staff.manage", null);
    const v = parse(c.staff, req.body),
      hash = await hashPassword(v.password);
    const row = await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(105,70)");
      await requirePermission(db, i, "staff.manage", null);
      const r = (
        await db.query(
          `INSERT INTO users(phone_e164,name_ar,password_hash,kind,status) VALUES($1,$2,$3,$4,'pending') RETURNING id`,
          [v.phone, v.name, hash, v.kind],
        )
      ).rows[0];
      if (v.kind === "courier")
        await db.query("INSERT INTO courier_profiles(user_id) VALUES($1)", [
          r.id,
        ]);
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "identity.internal_provisioned",
        "user",
        r.id,
        { kind: v.kind },
      );
      return r;
    });
    res
      .status(201)
      .json({ ...row, status: "pending", requiresPhoneVerification: true });
  });
  router.patch("/admin/staff/:id/status", async (req, res) => {
    const i = res.locals.identity as Identity,
      id = parse(c.uuid, req.params.id),
      v = parse(c.status, req.body);
    await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(105,70)");
      await requirePermission(db, i, "staff.manage", null);
      if (id === i.id)
        throw new ApiError(
          409,
          "SELF_CHANGE_FORBIDDEN",
          "لا يمكن تغيير حالة حسابك هنا",
        );
      const u = (
        await db.query(
          `SELECT id,phone_verified_at FROM users WHERE id=$1 AND kind IN ('staff','courier') AND status<>'deleted' FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!u) throw notFound();
      if (v.status === "disabled") {
        const critical = (
          await db.query(
            `SELECT 1 FROM staff_grants g JOIN roles r ON r.id=g.role_id WHERE g.user_id=$1 AND g.global_scope AND r.code='general_admin'`,
            [id],
          )
        ).rowCount;
        if (
          critical &&
          (
            await db.query(
              `SELECT count(DISTINCT u.id)::int AS n FROM users u JOIN staff_grants g ON g.user_id=u.id JOIN roles r ON r.id=g.role_id WHERE u.status='active' AND g.global_scope AND r.code='general_admin'`,
            )
          ).rows[0].n <= 1
        )
          throw new ApiError(
            409,
            "LAST_ADMIN",
            "لا يمكن تعطيل آخر مدير عام نشط",
          );
      }
      if (v.status === "active" && !u.phone_verified_at)
        throw new ApiError(409, "PHONE_UNVERIFIED", "يجب تأكيد الهاتف أولًا");
      await db.query("UPDATE users SET status=$2 WHERE id=$1", [id, v.status]);
      await db.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1",
        [id],
      );
      await db.query(
        "UPDATE otp_challenges SET consumed_at=coalesce(consumed_at,now()),pending_payload_encrypted=NULL WHERE user_id=$1",
        [id],
      );
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "identity.status_changed",
        "user",
        id,
        v,
      );
    });
    res.status(204).end();
  });
  router.get("/admin/staff/:id/grants", async (req, res) => {
    const i = res.locals.identity as Identity,
      id = parse(c.uuid, req.params.id),
      q = parse(z.strictObject({ branchId: z.uuid().optional() }), req.query);
    await requirePermission(
      pool,
      i,
      "staff.manage",
      q.branchId ? [q.branchId] : null,
    );
    const rows = (
      await pool.query(
        `SELECT g.id,g.role_id,g.branch_id,g.global_scope,r.name_ar AS role_name,array_agg(p.permission_code ORDER BY p.permission_code) AS permissions FROM staff_grants g JOIN roles r ON r.id=g.role_id JOIN role_permissions p ON p.role_id=r.id WHERE g.user_id=$1 AND ($2::uuid IS NULL OR g.branch_id=$2) GROUP BY g.id,r.name_ar ORDER BY g.id`,
        [id, q.branchId ?? null],
      )
    ).rows;
    if (
      !rows.length &&
      (q.branchId ||
        !(
          await pool.query(
            `SELECT 1 FROM users WHERE id=$1 AND kind='staff' AND status<>'deleted'`,
            [id],
          )
        ).rowCount)
    )
      throw notFound();
    res.json({ items: rows });
  });
  router.post("/admin/staff/:id/grants", async (req, res) => {
    const i = res.locals.identity as Identity,
      id = parse(c.uuid, req.params.id),
      v = parse(c.grant, req.body);
    const r = await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(105,70)");
      await requirePermission(db, i, "staff.manage", null);
      if (
        !(
          await db.query(
            `SELECT 1 FROM users WHERE id=$1 AND kind='staff' AND status<>'deleted'`,
            [id],
          )
        ).rowCount
      )
        throw notFound();
      const r = (
        await db.query(
          "INSERT INTO staff_grants(user_id,role_id,branch_id,global_scope) VALUES($1,$2,$3,$4) RETURNING id",
          [id, v.roleId, v.branchId, v.branchId === null],
        )
      ).rows[0];
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "access.grant_created",
        "staff_grant",
        r.id,
        { userId: id, roleId: v.roleId },
        v.branchId,
      );
      return r;
    });
    res.status(201).json(r);
  });
  router.delete("/admin/staff/:id/grants/:grantId", async (req, res) => {
    const i = res.locals.identity as Identity,
      id = parse(c.uuid, req.params.id),
      grantId = parse(c.uuid, req.params.grantId);
    await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(105,70)");
      await requirePermission(db, i, "staff.manage", null);
      const g = (
        await db.query(
          "SELECT * FROM staff_grants WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [grantId, id],
        )
      ).rows[0];
      if (!g) throw notFound();
      const r = (
        await db.query("SELECT code FROM roles WHERE id=$1", [g.role_id])
      ).rows[0];
      if (g.global_scope && r?.code === "general_admin") {
        const n = (
          await db.query(
            `SELECT count(*)::int AS n FROM staff_grants g JOIN users u ON u.id=g.user_id WHERE g.role_id=$1 AND g.global_scope AND u.status='active'`,
            [g.role_id],
          )
        ).rows[0].n;
        if (n <= 1)
          throw new ApiError(
            409,
            "LAST_ADMIN",
            "لا يمكن إزالة آخر مدير عام نشط",
          );
      }
      await db.query("DELETE FROM staff_grants WHERE id=$1", [grantId]);
      await audit(
        db,
        res.locals.requestId,
        i.id,
        "access.grant_deleted",
        "staff_grant",
        grantId,
        { userId: id },
        g.branch_id,
      );
    });
    res.status(204).end();
  });
  router.get("/admin/audit", async (req, res) => {
    const i = res.locals.identity as Identity,
      q = parse(c.branchQuery, req.query),
      scope = await accessScope(pool, i, "audit.read");
    if (q.branchId)
      await requirePermission(pool, i, "audit.read", [q.branchId]);
    if (!scope.global && !scope.branchIds.length) throw forbidden();
    res.json({
      items: (
        await pool.query(
          `SELECT id,actor_id,action,entity_type,entity_id,branch_id,before_redacted,after_redacted,request_id,created_at FROM audit_logs
   WHERE ($1::boolean OR branch_id=ANY($2::uuid[])) AND ($3::uuid IS NULL OR branch_id=$3) AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5`,
          [
            scope.global,
            scope.branchIds,
            q.branchId ?? null,
            q.cursor ?? null,
            q.limit,
          ],
        )
      ).rows,
    });
  });
  return router;
}
