import { addEngagementOpenapi } from "./engagement/openapi.js";
import { addOrdersOpenapi } from "./orders/openapi.js";
import { addCheckoutOpenapi } from "./checkout/openapi.js";
import { z } from "zod";
import * as c from "./identity/contracts.js";
import { responseSchemas, responseName } from "./identity/responses.js";
// Generated from the input contracts used by the actual handlers.
import { addCatalogOpenapi } from "./catalog/openapi.js";
import { addDeliveryOpenapi } from "./delivery/openapi.js";
export function openapi() { return addEngagementOpenapi(addDeliveryOpenapi(baseOpenapi())); }
function baseOpenapi() {
  const paths: Record<string, any> = {};
  const add = (
    method: string,
    path: string,
    summary: string,
    schema?: z.ZodType,
    secured = false,
    status = 200,
  ) => {
    const parameters: any[] = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    }));
    if (secured)
      parameters.push({
        name: "X-Client-App",
        in: "header",
        required: true,
        schema: { type: "string", enum: ["customer", "admin", "courier"] },
      });
    paths[path] ??= {};
    paths[path][method] = {
      summary,
      ...(parameters.length ? { parameters } : {}),
      ...(secured ? { security: [{ bearerAuth: [] }] } : {}),
      ...(schema
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: z.toJSONSchema(schema, {
                    io: "input",
                    unrepresentable: "any",
                  }),
                },
              },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: status === 204 ? "No content" : "Success",
          ...(status === 204
            ? {}
            : {
                content: {
                  "application/json": {
                    schema: {
                      $ref:
                        "#/components/schemas/" + responseName(method, path),
                    },
                  },
                },
              }),
        },
        ...Object.fromEntries(
          [
            [400, "Invalid JSON"],
            [401, "Authentication or challenge rejected"],
            [403, "Action or branch forbidden"],
            [404, "Resource not found"],
            [409, "Conflict"],
            [413, "JSON body exceeds16kb"],
            [422, "Validation rejected"],
            [429, "Rate limit or cooldown"],
            [500, "Unexpected server failure"],
            [503, "DB or OTP unavailable"],
          ].map(([code, description]) => [
            code,
            {
              description,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          ]),
        ),
      },
    };
  };
  for (const [path, schema, verify] of [
    ["register", c.registerStart, c.proof],
    ["login", c.loginStart, c.proof],
    ["password-reset", c.resetStart, c.resetVerify],
  ] as const) {
    add(
      "post",
      "/api/v1/auth/" + path + "/start",
      "Start " + path + " (purpose-bound OTP)",
      schema,
      false,
      202,
    );
    add("post", "/api/v1/auth/" + path + "/verify", "Verify " + path, verify);
  }
  add(
    "post",
    "/api/v1/auth/otp/resend",
    "Resend after 60 seconds; attempts preserved",
    c.resend,
    false,
    202,
  );
  add(
    "post",
    "/api/v1/auth/refresh",
    "Rotate refresh; reuse revokes family",
    c.refresh,
  );
  add(
    "post",
    "/api/v1/auth/logout",
    "Revoke current session",
    z.strictObject({}),
    true,
    204,
  );
  add("get", "/api/v1/me", "Own profile", undefined, true);
  add("patch", "/api/v1/me", "Update own name only", c.profile, true);
  add(
    "get",
    "/api/v1/me/addresses",
    "Own non-archived addresses",
    undefined,
    true,
  );
  add(
    "post",
    "/api/v1/me/addresses",
    "Create owned address",
    c.address,
    true,
    201,
  );
  add(
    "patch",
    "/api/v1/me/addresses/{id}",
    "Update owned address",
    c.addressPatch,
    true,
  );
  add(
    "delete",
    "/api/v1/me/addresses/{id}",
    "Archive owned address",
    undefined,
    true,
    204,
  );
  add("get", "/api/v1/admin/access", "Own live grants", undefined, true);
  add(
    "get",
    "/api/v1/admin/access/branches",
    "Branches authorized for permission",
    undefined,
    true,
  );
  paths["/api/v1/admin/access/branches"].get.parameters.push({
    name: "permission",
    in: "query",
    required: true,
    schema: { type: "string" },
  });
  for (const path of ["permissions", "roles", "staff", "audit"])
    add(
      "get",
      "/api/v1/admin/" + path,
      path === "audit"
        ? "Audit in authorized branches (audit.read)"
        : path === "staff"
          ? "Staff in requested branch (staff.manage)"
          : "Global staff.manage required",
      undefined,
      true,
    );
  for (const path of ["staff", "audit"])
    paths["/api/v1/admin/" + path].get.parameters.push(
      ...[
        {
          name: "branchId",
          in: "query",
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "cursor",
          in: "query",
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
      ],
    );
  add(
    "post",
    "/api/v1/admin/roles",
    "Create role (global staff.manage)",
    c.role,
    true,
    201,
  );
  add("put", "/api/v1/admin/roles/{id}", "Replace custom role", c.role, true);
  add(
    "delete",
    "/api/v1/admin/roles/{id}",
    "Delete unused custom role",
    undefined,
    true,
    204,
  );
  add(
    "post",
    "/api/v1/admin/staff",
    "Internally provision pending staff/courier",
    c.staff,
    true,
    201,
  );
  add(
    "patch",
    "/api/v1/admin/staff/{id}/status",
    "Change verified staff status; revoke sessions",
    c.status,
    true,
    204,
  );
  add(
    "get",
    "/api/v1/admin/staff/{id}/grants",
    "Read grants in permitted branch or global staff.manage",
    undefined,
    true,
  );
  paths["/api/v1/admin/staff/{id}/grants"].get.parameters.push({
    name: "branchId",
    in: "query",
    schema: { type: "string", format: "uuid" },
  });
  add(
    "post",
    "/api/v1/admin/staff/{id}/grants",
    "Grant role with branchId or null for global",
    c.grant,
    true,
    201,
  );
  add(
    "delete",
    "/api/v1/admin/staff/{id}/grants/{grantId}",
    "Revoke grant; protect last admin",
    undefined,
    true,
    204,
  );
  add("get", "/health/live", "Process liveness");
  add("get", "/health/ready", "DB/migration/OTP readiness");
  add("get", "/health", "Compatibility liveness");
  add("get", "/api/v1/openapi.json", "Phase05 document");
  for (const [path, method] of [
    ["/api/v1/admin/roles", "post"],
    ["/api/v1/admin/roles/{id}", "put"],
  ])
    paths[path!][method!].requestBody.content[
      "application/json"
    ].schema.properties.permissions.uniqueItems = true;
  paths["/api/v1/me/addresses/{id}"].patch.requestBody.content[
    "application/json"
  ].schema.minProperties = 1;
  const exampleId = "10000000-0000-4000-8000-000000000001";
  paths["/api/v1/auth/register/start"].post.requestBody.content[
    "application/json"
  ].example = {
    app: "customer",
    deviceId: "example-installation-identifier-000001",
    phone: "770000001",
    name: "مثال توثيقي غير مسجل",
    password: "<12-128 characters>",
  };
  paths["/api/v1/auth/register/start"].post.responses["202"].content[
    "application/json"
  ].example = {
    challengeId: exampleId,
    preauthToken: "A".repeat(43),
    expiresIn: 300,
    resendAfter: 60,
    message: "مثال توثيقي؛ ليس حسابًا أو رمزًا صالحًا",
  };
  paths["/api/v1/auth/login/verify"].post.responses["401"].content[
    "application/json"
  ].example = {
    error: {
      code: "CHALLENGE_INVALID",
      message: "الرمز أو التحدي غير صالح",
      details: null,
      requestId: exampleId,
    },
  };
  paths["/api/v1/admin/staff"].get.responses["403"].content[
    "application/json"
  ].example = {
    error: {
      code: "FORBIDDEN",
      message: "لا تملك صلاحية لهذا الإجراء والنطاق",
      details: null,
      requestId: exampleId,
    },
  };
  paths["/health/ready"].get.responses["503"] = {
    description: "Dependency not ready",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Ready" } },
    },
  };
  return addOrdersOpenapi(
    addCheckoutOpenapi(
      addCatalogOpenapi({
        openapi: "3.1.0",
        info: {
          title: "Tazweed Phase05 identity and access",
          version: "0.5.0",
          description:
            "Real PostgreSQL identity API. Apps remain local previews. Catalog/orders/payment services are deferred. OTP needs configured HTTPS gateway; no test codes returned.",
        },
        servers: [{ url: "/" }],
        paths,
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          },
          schemas: {
            ...responseSchemas,
            Challenge: {
              type: "object",
              required: [
                "challengeId",
                "preauthToken",
                "expiresIn",
                "resendAfter",
                "message",
              ],
              properties: {
                challengeId: { type: "string", format: "uuid" },
                preauthToken: { type: "string" },
                expiresIn: { const: 300 },
                resendAfter: { const: 60 },
                message: { type: "string" },
              },
            },
            Tokens: {
              type: "object",
              required: [
                "sessionId",
                "accessToken",
                "refreshToken",
                "tokenType",
                "expiresIn",
              ],
              properties: {
                sessionId: { type: "string", format: "uuid" },
                accessToken: { type: "string" },
                refreshToken: { type: "string" },
                tokenType: { const: "Bearer" },
                expiresIn: { const: 900 },
              },
            },
            Result: { type: "object" },
            Error: {
              type: "object",
              required: ["error"],
              properties: {
                error: {
                  type: "object",
                  required: ["code", "message", "details", "requestId"],
                  properties: {
                    code: { type: "string" },
                    message: { type: "string" },
                    details: {},
                    requestId: { type: "string", format: "uuid" },
                  },
                },
              },
            },
          },
        },
      }),
    ),
  );
}
