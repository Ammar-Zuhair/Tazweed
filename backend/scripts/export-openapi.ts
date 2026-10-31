import { readFile, writeFile } from "node:fs/promises";
import { openapi } from "../src/openapi.js";
const file = new URL("../docs/openapi.phase05.json", import.meta.url),
  json = JSON.stringify(openapi(), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8")) !== json)
    throw new Error("OpenAPI document differs from live contracts");
  console.log("OpenAPI matches live contracts");
} else {
  await writeFile(file, json);
  console.log("Wrote docs/openapi.phase05.json");
}
