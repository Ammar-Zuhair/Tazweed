import { z } from "zod";
import * as c from "./contracts.js";
export function addCatalogOpenapi(doc: any) {
  const add = (
    method: string,
    path: string,
    schema?: z.ZodType,
    auth = true,
  ) => {
    const parameters: any[] = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      in: "path",
      name: m[1],
      required: true,
      schema: { type: "string", format: "uuid" },
    }));
    if (auth)
      parameters.push({
        in: "header",
        name: "X-Client-App",
        required: true,
        schema: { enum: ["customer", "admin", "courier"] },
      });
    if (path.includes("/inventory/") && method === "post")
      parameters.push({
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", minLength: 16, maxLength: 100 },
      });
    const success =
      method === "post" &&
      !path.includes("inventory") &&
      !path.endsWith("/complete")
        ? 201
        : 200;
    doc.paths[path] ??= {};
    doc.paths[path][method] = {
      tags: ["Phase06"],
      summary: path,
      parameters,
      ...(auth ? { security: [{ bearerAuth: [] }] } : {}),
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
        [success]: {
          description: "Success; money and stock integers are strings",
          content: { "application/json": { schema: { type: "object" } } },
        },
        ...Object.fromEntries(
          [401, 403, 404, 409, 422, 429, 503].map((n) => [
            n,
            {
              description: "Rejected or unavailable",
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
  for (const [path, schema] of [
    ["governorates", c.governorate],
    ["branches", c.branch],
    ["categories", c.category],
    ["attributes", c.attribute],
    ["attribute-values", c.value],
    ["products", c.product],
  ] as const) {
    add("get", "/api/v1/admin/" + path);
    add("post", "/api/v1/admin/" + path, schema);
    add("put", "/api/v1/admin/" + path + "/{id}", schema);
  }
  for (const path of [
    "/public/governorates",
    "/public/branches",
    "/catalog/categories",
    "/catalog/categories/{id}/filters",
    "/catalog/products",
    "/catalog/products/{id}",
  ])
    add("get", "/api/v1" + path, undefined, false);
  for (const path of [
    "/public/governorates",
    "/public/branches",
    "/catalog/categories",
    "/catalog/products",
  ])
    doc.paths["/api/v1" + path].get.parameters.push(
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 100 },
      },
      {
        in: "query",
        name: "cursor",
        schema: { type: "string", format: "uuid" },
      },
    );
  for (const path of [
    "/public/branches",
    "/catalog/products",
    "/catalog/products/{id}",
  ])
    doc.paths["/api/v1" + path].get.parameters.push({
      in: "query",
      name: "governorateId",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  doc.paths["/api/v1/catalog/products"].get.parameters.push(
    ...["categoryId", "search", "attributeValueIds"].map((name) => ({
      in: "query",
      name,
      schema: { type: "string" },
    })),
  );
  add("get", "/api/v1/admin/categories/{id}/attributes");
  add("put", "/api/v1/admin/categories/{id}/attributes", c.categoryAttributes);
  add("get", "/api/v1/admin/attributes/{id}/values");
  add(
    "post",
    "/api/v1/admin/attributes/{id}/values",
    c.value.omit({ attribute_id: true }),
  );
  add("get", "/api/v1/admin/products/{productId}/units");
  add("post", "/api/v1/admin/products/{productId}/units", c.unit);
  add("put", "/api/v1/admin/products/{productId}/units/{id}", c.unit);
  add("put", "/api/v1/admin/branch-prices", c.price);
  add("get", "/api/v1/admin/branch-prices");
  add("get", "/api/v1/admin/stock-products");
  add("get", "/api/v1/admin/products/{id}");
  add(
    "put",
    "/api/v1/admin/branches/{branchId}/unit-prices/{unitId}",
    c.price.omit({ branch_id: true, unit_id: true }),
  );
  add(
    "put",
    "/api/v1/admin/governorates/{id}/catalog-branch",
    z.strictObject({ branchId: c.id.nullable() }),
  );
  add(
    "put",
    "/api/v1/admin/branches/{id}/delivery-rule",
    z.strictObject({
      base_yer: c.money,
      per_km_yer: c.money,
      max_distance_m: z.number().int().positive(),
    }),
  );
  add(
    "patch",
    "/api/v1/admin/branches/{id}/delivery-enabled",
    z.strictObject({ enabled: z.boolean() }),
  );
  for (const path of ["/inventory", "/inventory/movements"]) {
    add("get", "/api/v1/admin" + path);
    doc.paths["/api/v1/admin" + path].get.parameters.push(
      {
        in: "query",
        name: "branchId",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        in: "query",
        name: "limit",
        schema: { type: "integer", minimum: 1, maximum: 100 },
      },
      {
        in: "query",
        name: "cursor",
        schema: { type: "string", format: "uuid" },
      },
    );
  }
  for (const path of ["/adjust", "/adjustments", "/receipts"])
    add("post", "/api/v1/admin/inventory" + path, c.stock);
  add("post", "/api/v1/admin/inventory/transfers", c.transfer);
  add("post", "/api/v1/media/uploads", c.upload);
  add("post", "/api/v1/media/uploads/{id}/complete", z.strictObject({}));
  add("get", "/api/v1/media/{id}/access");
  add("get", "/api/v1/media/{id}/public", undefined, false);
  doc.info.version = "0.6.0";
  doc.info.description =
    "Identity and phase06 catalog/inventory/media. PostgreSQL is authoritative; OTP/R2 require server-only provider configuration. No phase07 order/route pricing.";
  return doc;
}
