// Response schemas describe only the routes actually implemented in05.
const str = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  nullableUuid = { type: ["string", "null"], format: "uuid" },
  time = { type: "string", format: "date-time" };
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const list = (item: unknown) =>
  object({ items: { type: "array", items: item, maxItems: 100 } });
const grant = object({
  id: uuid,
  role_id: uuid,
  branch_id: nullableUuid,
  global_scope: { type: "boolean" },
  permissions: { type: "array", items: str },
});
export const responseSchemas: Record<string, any> = {
  CreatedId: object({ id: uuid }),
  Reset: object({ passwordReset: { const: true } }),
  Resent: object({
    challengeId: uuid,
    expiresIn: { const: 300 },
    resendAfter: { const: 60 },
  }),
  Profile: object({
    id: uuid,
    name: str,
    phone: str,
    kind: { enum: ["customer", "staff", "courier"] },
    app: { enum: ["customer", "admin", "courier"] },
  }),
  ProfileUpdated: object({ id: uuid, name: str }),
  Addresses: list(
    object({
      id: uuid,
      governorate_id: uuid,
      label: str,
      description: { type: ["string", "null"] },
      latitude: { type: "number" },
      longitude: { type: "number" },
      is_default: { type: "boolean" },
    }),
  ),
  Grants: list({
    ...grant,
    properties: { ...grant.properties, role_name: str },
    required: [...grant.required, "role_name"],
  }),
  OwnAccess: object({ grants: { type: "array", items: grant } }),
  Branches: list(object({ id: uuid, name_ar: str, governorate_id: uuid })),
  Permissions: list(object({ code: str, name_ar: str })),
  Roles: list(
    object({
      id: uuid,
      code: str,
      name_ar: str,
      permissions: { type: "array", items: str },
    }),
  ),
  Staff: list(
    object({
      id: uuid,
      name_ar: str,
      kind: { enum: ["staff", "courier"] },
      status: { enum: ["pending", "active", "disabled", "deleted"] },
    }),
  ),
  InternalUser: object({
    id: uuid,
    status: { const: "pending" },
    requiresPhoneVerification: { const: true },
  }),
  Audit: list(
    object({
      id: uuid,
      actor_id: nullableUuid,
      action: str,
      entity_type: str,
      entity_id: nullableUuid,
      branch_id: nullableUuid,
      before_redacted: { type: ["object", "null"] },
      after_redacted: { type: ["object", "null"] },
      request_id: str,
      created_at: time,
    }),
  ),
  Live: object({
    service: { const: "tazweed-backend" },
    phase: { const: "05" },
    status: { const: "ok" },
    businessServices: { const: "identity-only" },
  }),
  Ready: object({
    service: { const: "tazweed-backend" },
    phase: { const: "05" },
    status: { enum: ["ready", "not-ready"] },
    database: { enum: ["connected", "unavailable"] },
    migrations: { enum: ["current", "unavailable"] },
    runtimeRole: { enum: ["limited", "unsafe-or-unavailable"] },
    otp: { enum: ["unconfigured", "https-gateway", "test"] },
  }),
};
export function responseName(method: string, path: string) {
  if (path.endsWith("/start")) return "Challenge";
  if (path.endsWith("/otp/resend")) return "Resent";
  if (path.endsWith("/password-reset/verify")) return "Reset";
  if (path.endsWith("/verify") || path.endsWith("/refresh")) return "Tokens";
  if (path === "/health/ready") return "Ready";
  if (path.startsWith("/health")) return "Live";
  if (path.endsWith("/me"))
    return method === "get" ? "Profile" : "ProfileUpdated";
  if (path.endsWith("/me/addresses"))
    return method === "get" ? "Addresses" : "CreatedId";
  if (path.includes("/addresses/")) return "CreatedId";
  if (path.endsWith("/admin/access")) return "OwnAccess";
  if (path.endsWith("/access/branches")) return "Branches";
  if (path.endsWith("/permissions")) return "Permissions";
  if (path.endsWith("/audit")) return "Audit";
  if (path.endsWith("/grants"))
    return method === "get" ? "Grants" : "CreatedId";
  if (path.endsWith("/admin/staff"))
    return method === "get" ? "Staff" : "InternalUser";
  if (path.endsWith("/admin/roles"))
    return method === "get" ? "Roles" : "CreatedId";
  if (path.includes("/admin/roles/")) return "CreatedId";
  return "Result";
}
