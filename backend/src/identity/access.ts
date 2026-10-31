import type { RequestHandler, Request } from "express";
import type { Db } from "../db.js";
import { forbidden, invalidAuth } from "../http.js";
import { app, uuid } from "./contracts.js";
import type { App } from "./contracts.js";
import type { Security } from "./security.js";
export type Identity = {
  id: string;
  kind: "customer" | "staff" | "courier";
  app: App;
  sessionId: string;
  name_ar: string;
  phone_e164: string;
};
export function authenticate(db: Db, security: Security): RequestHandler {
  return async (req, res, next) => {
    const a = app.safeParse(req.get("X-Client-App"));
    const token = req.get("Authorization");
    if (!a.success || !token?.startsWith("Bearer ")) throw invalidAuth();
    let claims;
    try {
      claims = await security.readAccess(token.slice(7), a.data);
    } catch {
      throw invalidAuth();
    }
    if (
      !uuid.safeParse(claims.userId).success ||
      !uuid.safeParse(claims.sessionId).success
    )
      throw invalidAuth();
    const r = await db.query(
      `SELECT u.id,u.kind,u.name_ar,u.phone_e164,s.id AS session_id FROM users u JOIN sessions s ON s.user_id=u.id
   WHERE u.id=$1 AND s.id=$2 AND s.app=$3 AND u.status='active' AND s.revoked_at IS NULL AND s.expires_at>now()
   AND (u.kind<>'courier' OR EXISTS(SELECT 1 FROM courier_profiles c WHERE c.user_id=u.id AND c.active))`,
      [claims.userId, claims.sessionId, a.data],
    );
    const row = r.rows[0];
    if (!row || row.kind !== (a.data === "admin" ? "staff" : a.data))
      throw invalidAuth();
    res.locals.identity = {
      id: row.id,
      kind: row.kind,
      name_ar: row.name_ar,
      phone_e164: row.phone_e164,
      app: a.data,
      sessionId: row.session_id,
    } satisfies Identity;
    next();
  };
}
export async function accessScope(
  db: Db,
  identity: Identity,
  permission: string,
) {
  if (identity.kind !== "staff" || identity.app !== "admin") throw forbidden();
  const rows = (
    await db.query(
      `SELECT g.branch_id,g.global_scope FROM staff_grants g
  JOIN role_permissions p ON p.role_id=g.role_id JOIN users u ON u.id=g.user_id
  WHERE g.user_id=$1 AND p.permission_code=$2 AND u.status='active' AND u.kind='staff'`,
      [identity.id, permission],
    )
  ).rows;
  return {
    global: rows.some((r) => r.global_scope),
    branchIds: rows
      .filter((r) => r.branch_id)
      .map((r) => r.branch_id as string),
  };
}
export async function requirePermission(
  db: Db,
  identity: Identity,
  permission: string,
  branchIds: string[] | null,
) {
  const scope = await accessScope(db, identity, permission);
  if (scope.global) return scope;
  // Global actions require a global grant. All source/destination branches must be authorized.
  if (
    !branchIds?.length ||
    !branchIds.every((id) => scope.branchIds.includes(id))
  )
    throw forbidden();
  return scope;
}
export function customerOnly(identity: Identity) {
  if (identity.kind !== "customer" || identity.app !== "customer")
    throw forbidden();
}
export function requestContext(req: Request, requestId: string) {
  return { requestId, ip: req.ip ?? req.socket.remoteAddress ?? "unknown" };
}
