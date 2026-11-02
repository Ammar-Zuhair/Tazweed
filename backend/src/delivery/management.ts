import type pg from "pg";
import { idempotent } from "../catalog/stock.js";
import { requirePermission, type Identity } from "../identity/access.js";
import { hashPassword } from "../identity/security.js";
import { courierLock, courierScope, recorded } from "./core.js";
import { conflict } from "../orders/core.js";
import { ApiError } from "../http.js";
export async function saveCourier(
  pool: pg.Pool,
  i: Identity,
  id: string | null,
  key: string,
  v: any,
) {
  const auth = async (db: any) => {
    if (id) await courierScope(db, i, id, "couriers.manage");
    else await requirePermission(db, i, "couriers.manage", null);
    await requirePermission(db, i, "couriers.manage", v.branchIds);
  };
  await auth(pool);
  const hash = id ? null : await hashPassword(v.password);
  // Idempotency stores a request digest and identifiers only; no password in its response.
  return idempotent(
    pool,
    i,
    "courier.save." + (id ?? "new"),
    key,
    v,
    async (db) => {
      if (id) await courierLock(db, id);
      await auth(db);
      if (
        (
          await db.query(
            "SELECT id FROM branches WHERE id=ANY($1::uuid[]) AND active",
            [v.branchIds],
          )
        ).rowCount !== new Set(v.branchIds).size
      )
        throw new ApiError(422, "INVALID_BRANCH", "اختر فروعًا نشطة");
      if (id) {
        if (
          !v.active &&
          (
            await db.query(
              "SELECT 1 FROM order_assignments a JOIN orders o ON o.id=a.order_id WHERE a.courier_id=$1 AND a.ended_at IS NULL AND o.status IN ('confirmed','on_the_way')",
              [id],
            )
          ).rowCount
        )
          throw conflict(
            "ACTIVE_TASKS",
            "أنهِ أو أعد إسناد المهام الجارية قبل تعطيل الموصل",
          );
        if (
          (
            await db.query(
              "SELECT 1 FROM order_assignments a JOIN orders o ON o.id=a.order_id WHERE a.courier_id=$1 AND a.ended_at IS NULL AND o.status IN ('confirmed','on_the_way') AND NOT(o.branch_id=ANY($2::uuid[]))",
              [id, v.branchIds],
            )
          ).rowCount
        )
          throw conflict("ACTIVE_BRANCH_TASKS", "لا تحذف فرع مهام جارية");
        await db.query("UPDATE users SET name_ar=$2 WHERE id=$1", [id, v.name]);
        await db.query(
          "UPDATE courier_profiles SET active=$2,commission_bps=$3 WHERE user_id=$1",
          [id, v.active, v.commissionBps],
        );
        await db.query("DELETE FROM courier_branches WHERE courier_id=$1", [
          id,
        ]);
      } else {
        id = (
          await db.query(
            "INSERT INTO users(phone_e164,name_ar,password_hash,kind,status) VALUES($1,$2,$3,'courier','active') RETURNING id",
            [v.phone, v.name, hash],
          )
        ).rows[0].id;
        await db.query(
          "INSERT INTO courier_profiles(user_id,commission_bps,active) VALUES($1,$2,$3)",
          [id, v.commissionBps, v.active],
        );
      }
      for (const b of new Set(v.branchIds))
        await db.query(
          "INSERT INTO courier_branches(courier_id,branch_id) VALUES($1,$2)",
          [id, b],
        );
      const { audit } = await import("../identity/audit.js");
      await audit(
        db,
        i.requestId ?? id!,
        i.id,
        "courier.configured",
        "courier",
        id,
        {
          commissionBps: v.commissionBps,
          active: v.active,
          branchIds: v.branchIds,
        },
        null,
      );
      return { id };
    },
  );
}
