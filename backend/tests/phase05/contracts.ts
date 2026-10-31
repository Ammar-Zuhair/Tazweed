import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { openapi } from "../../src/openapi.js";
// Validate real HTTP responses with the published 2020-12 response schemas.
export function responseContracts() {
  const doc = openapi(),
    ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const cache = new Map<string, ReturnType<typeof ajv.compile>>();
  let checked = 0;
  return {
    get checked() {
      return checked;
    },
    check(method: string, url: string, status: number, body: unknown) {
      const path = url.split("?")[0]!;
      const pair = Object.entries(doc.paths).find(
        ([p]) =>
          p.split("/").length === path.split("/").length &&
          p
            .split("/")
            .every((s, i) => s.startsWith("{") || s === path.split("/")[i]),
      );
      if (!pair) return;
      const operation = pair[1][method.toLowerCase()];
      if (!operation) return;
      const schema =
        operation.responses[String(status)]?.content?.["application/json"]
          ?.schema;
      if (status === 204) {
        assert.equal(body, null);
        return;
      }
      assert(
        schema,
        `Undocumented response status ${method} ${pair[0]} ${status}`,
      );
      const key = method + " " + pair[0] + " " + status;
      let validate = cache.get(key);
      if (!validate) {
        const root = JSON.parse(
          JSON.stringify({
            ...schema,
            $defs: doc.components.schemas,
          }).replaceAll("#/components/schemas/", "#/$defs/"),
        );
        validate = ajv.compile(root);
        cache.set(key, validate);
      }
      assert(
        validate(body),
        `Response contract failed: ${key} ${JSON.stringify(validate.errors)}`,
      );
      checked++;
    },
  };
}
