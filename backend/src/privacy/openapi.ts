import { z } from "zod";
import * as c from "./contracts.js";
import { reportInput } from "../reports/service.js";
export function addPrivacyOpenapi(doc: any) {
  const json = (x: z.ZodType) =>
    z.toJSONSchema(x, { io: "input", unrepresentable: "any" });
  const receipt = z.object({
    id: z.uuid(),
    status: z.enum([
      "requested",
      "verified",
      "processing",
      "completed",
      "needs_review",
    ]),
    verifiedAt: z.string().nullable(),
    accountErasedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    retainedUntil: z.string().nullable(),
    notice: z.string(),
    policyVersion: z.string().nullable(),
  });
  const challenge = z.object({
    challengeId: z.uuid(),
    preauthToken: z.string(),
    requestId: z.uuid(),
    receiptToken: z.string(),
    expiresIn: z.literal(300),
    resendAfter: z.literal(60),
    message: z.string(),
  });
  const add = (
    method: string,
    path: string,
    response: z.ZodType,
    body?: z.ZodType,
    secured = false,
    status = 200,
  ) => {
    const params: any[] = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    }));
    if (secured)
      params.push({
        name: "X-Client-App",
        in: "header",
        required: true,
        schema: {
          enum: path.includes("/admin/")
            ? ["admin"]
            : ["customer", "admin", "courier"],
        },
      });
    if (path.startsWith("/web/"))
      params.push({
        name: "X-Deletion-Flow",
        in: "header",
        required: true,
        schema: { const: "1" },
      });
    if (path.endsWith("monthly-sales"))
      params.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 16, maxLength: 100 },
      });
    doc.paths[path] ??= {};
    doc.paths[path][method] = {
      summary: "Phase11 " + method + " " + path,
      parameters: params,
      ...(secured ? { security: [{ bearerAuth: [] }] } : {}),
      ...(body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: json(body) } },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: "Authoritative state",
          content: { "application/json": { schema: json(response) } },
        },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 413, 422, 429, 500, 503].map((n) => [
            n,
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
  };
  add(
    "get",
    "/api/v1/public/legal",
    z.object({
      policy: z.object({ approved: z.boolean() }).loose(),
      privacy: z.array(z.object({ title: z.string(), body: z.string() })),
      terms: z.array(z.object({ title: z.string(), body: z.string() })),
    }),
  );
  add(
    "post",
    "/api/v1/me/deletion-requests/start",
    challenge,
    c.start,
    true,
    202,
  );
  add(
    "post",
    "/api/v1/me/deletion-requests",
    receipt.extend({ receiptToken: z.string() }),
    c.proof,
    true,
  );
  add("get", "/api/v1/me/deletion-requests/{id}", receipt, undefined, true);
  add(
    "post",
    "/api/v1/account-deletion/verify",
    receipt.extend({ receiptToken: z.string() }),
    c.proof,
  );
  add("post", "/api/v1/account-deletion/status", receipt, c.status);
  add("post", "/web/account-deletion/start", challenge, c.start, false, 202);
  add(
    "post",
    "/web/account-deletion/verify",
    receipt.extend({ receiptToken: z.string() }),
    c.proof,
  );
  add("post", "/web/account-deletion/status", receipt, c.status);
  add(
    "get",
    "/api/v1/admin/deletion-requests",
    z.object({
      items: z.array(
        receipt.extend({ userId: z.uuid(), reviewCode: z.string().nullable() }),
      ),
    }),
    undefined,
    true,
  );
  add(
    "post",
    "/api/v1/admin/deletion-requests/{id}/process",
    z.object({ processed: z.boolean() }),
    z.strictObject({}),
    true,
  );
  add(
    "post",
    "/api/v1/admin/reports/monthly-sales",
    z.object({ id: z.uuid() }),
    reportInput,
    true,
  );
  add(
    "get",
    "/api/v1/admin/reports/{id}",
    z.object({
      id: z.uuid(),
      state: z.enum(["pending", "processing", "ready", "failed"]),
      error: z.string().nullable(),
      summary: z.object({}).loose().nullable(),
      expiresAt: z.string(),
    }),
    undefined,
    true,
  );
  add(
    "get",
    "/api/v1/admin/reports/{id}/download",
    z.object({}),
    undefined,
    true,
  );
  doc.paths["/api/v1/admin/reports/{id}/download"].get.responses[200] = {
    description: "Private Arabic PDF; live permission checked, no public URL",
    content: {
      "application/pdf": { schema: { type: "string", format: "binary" } },
    },
  };
  for (const path of ["/privacy", "/terms", "/support", "/delete-account"])
    doc.paths[path] = {
      get: {
        summary: "Public Arabic page without app install",
        responses: {
          200: {
            description: "Arabic HTML",
            content: { "text/html": { schema: { type: "string" } } },
          },
        },
      },
    };
  return doc;
}
