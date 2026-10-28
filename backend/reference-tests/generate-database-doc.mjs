// Generate/check the dictionary from an isolated execution of the actual SQL.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { schema, readCatalog } from "./helpers.mjs";

const path = new URL("../docs/DATABASE.md", import.meta.url);
const marker = "<!-- BEGIN GENERATED SCHEMA DICTIONARY -->";
const existing = readFileSync(path, "utf8");
if (!existing.includes(marker)) throw new Error("Dictionary marker missing");
const db = new PGlite();
const inline = (value) =>
  "`" +
  String(value ?? "—")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;") +
  "`";
try {
  await db.exec(schema);
  const { tables, columns, constraints, triggers } = await readCatalog(db);
  const out = [
    existing.split(marker)[0] + marker,
    "",
    "## قاموس الجداول المولد",
    "",
    `عدد الجداول الفعلي: **${tables.length}**. عدد حراس triggers الصريحة: **${triggers.length}**.`,
    "",
    `SHA-256 للمخطط: ${inline(createHash("sha256").update(schema).digest("hex"))}.`,
    "",
  ];
  for (const name of tables) {
    out.push(
      `### ${inline(name)}`,
      "",
      "| الحقل | النوع | NOT NULL | الافتراضي/التوليد |",
      "|---|---|---|---|",
    );
    for (const column of columns.filter((c) => c.table_name === name)) {
      const expression = column.generated
        ? `GENERATED ALWAYS AS (${column.default_expression}) STORED`
        : column.identity
          ? "GENERATED ALWAYS AS IDENTITY"
          : column.default_expression;
      out.push(
        `| ${inline(column.column_name)} | ${inline(column.type)} | ${column.not_null ? "نعم" : "لا"} | ${inline(expression)} |`,
      );
    }
    out.push("", "القيود:", "");
    for (const item of constraints.filter((c) => c.table_name === name))
      out.push(`- ${inline(item.name)}: ${inline(item.definition)}`);
    const guards = triggers.filter((t) => t.table_name === name);
    if (guards.length) {
      out.push("", "الحراس:", "");
      for (const trigger of guards)
        out.push(`- ${inline(trigger.name)}: ${inline(trigger.definition)}`);
    }
    out.push("");
  }
  out.push("<!-- END GENERATED SCHEMA DICTIONARY -->", "");
  const generated = out.join("\n");
  if (process.argv.includes("--check")) {
    if (generated !== existing)
      throw new Error(
        "DATABASE.md differs from actual schema metadata; regenerate it",
      );
    console.log(
      `Dictionary matches actual SQL: ${tables.length} tables, ${triggers.length} triggers.`,
    );
  } else {
    writeFileSync(path, generated);
    console.log(
      `Generated dictionary: ${tables.length} tables, ${triggers.length} triggers.`,
    );
  }
} finally {
  await db.close();
}
