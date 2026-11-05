import { z } from "zod";
import * as c from "./contracts.js";
const row = z.object({ id: c.id }).loose(),
  v = z.object({ version: z.number().int().positive() }),
  result = row.extend({ version: z.number().int().positive() });
const notice = z.object({
  id: c.id,
  title: z.string(),
  body: z.string(),
  data: z.object({ kind: z.string(), orderId: c.id.optional() }),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
const release = z.object({
  minimumBuild: z.number().int().positive(),
  latestBuild: z.number().int().positive(),
  latestVersion: z.string(),
  storeUrl: z.string(),
  message: z.string(),
  version: z.number().int().positive(),
  required: z.boolean(),
  optional: z.boolean(),
});
export function addEngagementOpenapi(doc: any) {
  const json = (s: z.ZodType) =>
    z.toJSONSchema(s, { io: "input", unrepresentable: "any" });
  function add(
    method: string,
    path: string,
    response: z.ZodType,
    body?: z.ZodType,
    query?: z.ZodObject,
  ) {
    const pub = path === "/public/config",
      parameters: any[] = [];
    if (!pub)
      parameters.push({
        name: "X-Client-App",
        in: "header",
        required: true,
        schema: {
          enum: path.startsWith("/admin")
            ? ["admin"]
            : ["customer", "admin", "courier"],
        },
      });
    for (const m of path.matchAll(/\{(\w+)\}/g))
      parameters.push({
        name: m[1],
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    if (path.startsWith("/admin/campaigns") && method === "post")
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 16, maxLength: 100 },
      });
    if (query) {
      const j: any = json(query);
      for (const [name, schema] of Object.entries(j.properties))
        parameters.push({
          name,
          in: "query",
          required: j.required?.includes(name) ?? false,
          schema,
        });
    }
    doc.paths["/api/v1" + path] ??= {};
    doc.paths["/api/v1" + path][method] = {
      summary: "Phase10 " + method + " " + path,
      parameters,
      ...(!pub ? { security: [{ bearerAuth: [] }] } : {}),
      ...(body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: json(body) } },
            },
          }
        : {}),
      responses: {
        200: {
          description: "Authoritative state; environment chosen by server",
          content: { "application/json": { schema: json(response) } },
        },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 413, 422, 429, 500, 503].map((s) => [
            s,
            {
              description: "Rejected",
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
  }
  add(
    "get",
    "/public/config",
    z.object({
      environment: z.enum(["staging", "production"]),
      maintenance: z.object({
        enabled: z.boolean(),
        message: z.string(),
        version: z.number().int().positive(),
      }),
      release: release.nullable(),
    }),
    undefined,
    c.publicConfig,
  );
  add("post", "/devices/push-tokens", row, c.token);
  add(
    "delete",
    "/devices/push-tokens",
    z.object({ ok: z.literal(true), revoked: z.number().int().min(0) }),
    z.object({}).strict(),
  );
  add(
    "get",
    "/notifications",
    z.object({
      items: z.array(notice),
      nextCursor: c.id.nullable(),
      source: z.literal("backend"),
    }),
    undefined,
    c.page,
  );
  add("get", "/notifications/{id}", notice);
  add(
    "patch",
    "/notifications/{id}/read",
    z.object({ ok: z.literal(true) }),
    z.object({}).strict(),
  );
  add(
    "get",
    "/admin/customer-maintenance",
    z.object({
      enabled: z.boolean(),
      message_ar: z.string(),
      version: z.number().int().positive(),
      updated_at: z.string(),
    }),
  );
  add("put", "/admin/customer-maintenance", v, c.maintenance);
  add(
    "get",
    "/admin/app-releases",
    z.object({
      environment: z.enum(["staging", "production"]),
      items: z.array(
        row.extend({
          app: c.app,
          platform: c.platform,
          environment: z.enum(["staging", "production"]),
          minimum_build: z.number().int().positive(),
          latest_build: z.number().int().positive(),
          latest_version: z.string(),
          store_url: z.string(),
          message_ar: z.string().nullable(),
          version: z.number().int().positive(),
          binary_confirmed: z.boolean(),
        }),
      ),
    }),
  );
  add("put", "/admin/app-releases", result, c.release);
  add(
    "get",
    "/admin/campaigns",
    z.object({
      items: z.array(
        row.extend({
          title_ar: z.string(),
          body_ar: z.string(),
          audience: c.audience,
          status: z.enum([
            "draft",
            "scheduled",
            "sending",
            "sent",
            "cancelled",
            "failed",
          ]),
          scheduled_at: z.string().nullable(),
          version: z.number().int().positive(),
          error_code: z.string().nullable(),
          created_at: z.string(),
          finished_at: z.string().nullable(),
        }),
      ),
      nextCursor: c.id.nullable(),
    }),
    undefined,
    c.page,
  );
  add("post", "/admin/campaigns", result, c.campaign);
  add("post", "/admin/campaigns/{id}/schedule", result, c.schedule);
  add("post", "/admin/campaigns/{id}/cancel", result, c.cancel);
  doc.info.version = "0.10.0";
  return doc;
}
