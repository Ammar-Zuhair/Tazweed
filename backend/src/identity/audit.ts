import type { Db } from "../db.js";
// Callers supply allowlisted state/IDs only; never request bodies, phones, passwords or tokens.
export async function audit(
  db: Db,
  requestId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  after: unknown = null,
  branchId: string | null = null,
) {
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,branch_id,after_redacted,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      actorId,
      action,
      entityType,
      entityId,
      branchId,
      after ? JSON.stringify(after) : null,
      requestId,
    ],
  );
}
