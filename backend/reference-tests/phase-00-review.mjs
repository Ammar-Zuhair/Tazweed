// Deliberately scoped diagnostics of what still belongs to future services.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeFixture, schema, readCatalog } from "./helpers.mjs";
const f = await makeFixture();
const {
  db,
  insert,
  category,
  branch,
  product,
  staff,
  piece,
  newOrder,
  newQuote,
} = f;
const observations = [];
const timeBoundaryChecks = [];
async function observe(id, label, callback) {
  await db.exec("BEGIN");
  try {
    await callback();
    observations.push({
      id,
      label,
      observed: "allowed",
      interpretation:
        "Future service obligation; not a successful application behavior.",
    });
  } finally {
    await db.exec("ROLLBACK");
  }
}
try {
  await observe(
    "SV01",
    "Product activation must validate required attributes",
    async () => {
      await insert("products", {
        sku: "MISSING_REQUIRED_REVIEW",
        category_id: category.id,
        name_ar: "اختبار دون خاصية",
      });
    },
  );
  await observe(
    "SV02",
    "Inventory service must reconcile reserved counter with active holds",
    async () => {
      await db.query(
        "UPDATE stock_levels SET reserved=1 WHERE branch_id=$1 AND product_id=$2",
        [branch.id, product.id],
      );
      assert.equal(
        Number(
          (
            await db.query(
              "SELECT count(*) AS n FROM stock_reservations WHERE state='active'",
            )
          ).rows[0].n,
        ),
        0,
      );
    },
  );
  await observe(
    "SV03",
    "No implicit inherited attributes or multi-node category cycle guard",
    async () => {
      const a = await insert("categories", { name_ar: "اختبار أ" });
      const b = await insert("categories", {
        name_ar: "اختبار ب",
        parent_id: a.id,
      });
      await db.query("UPDATE categories SET parent_id=$1 WHERE id=$2", [
        b.id,
        a.id,
      ]);
    },
  );
  await observe(
    "SV04",
    "A revalidation record does not itself compare live branch prices",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await db.query("UPDATE product_units SET price_yer=6000 WHERE id=$1", [
        piece.id,
      ]);
      await insert("quote_revalidations", {
        quote_id: q.id,
        checked_by: staff.id,
        valid_until: new Date(Date.now() + 1800000).toISOString(),
        reason:
          "Diagnostic: SQL cannot prove actual external/service price checks",
      });
    },
  );
  // Cross a real transaction time boundary: no fake successful worker/API.
  await db.exec("BEGIN");
  const expiringAt = (
    await db.query("SELECT now()+interval '50 milliseconds' AS expiry")
  ).rows[0].expiry;
  const reported = await newOrder({ payment_kind: "transfer" });
  const protectedQuote = await newQuote(reported, { expires_at: expiringAt });
  await f.reserve(reported, protectedQuote);
  const transfer = await f.transfer(reported, protectedQuote);
  await f.review(transfer.payment, transfer.attempt);
  await db.exec("COMMIT");
  await new Promise((resolve) => setTimeout(resolve, 100));
  await db.exec("BEGIN");
  assert.equal(
    (
      await db.query(
        "SELECT expires_at<now() AS expired FROM order_quotes WHERE id=$1",
        [protectedQuote.id],
      )
    ).rows[0].expired,
    true,
  );
  await f.confirm(reported);
  await db.exec("ROLLBACK");
  timeBoundaryChecks.push({
    id: "T01",
    passed: true,
    label:
      "Verified transfer retains protected stock and accepted price across original quote expiry",
  });

  await db.exec("BEGIN");
  const cashExpiry = (
    await db.query("SELECT now()+interval '50 milliseconds' AS expiry")
  ).rows[0].expiry;
  const cash = await newOrder();
  const cashQuote = await newQuote(cash, { expires_at: cashExpiry });
  const oldReservation = await f.reserve(cash, cashQuote, {
    expires_at: cashExpiry,
  });
  await db.exec("COMMIT");
  await new Promise((resolve) => setTimeout(resolve, 100));
  await db.exec("BEGIN");
  await f.reject(() => f.confirm(cash));
  await db.query("UPDATE stock_reservations SET state='expired' WHERE id=$1", [
    oldReservation.id,
  ]);
  await db.query(
    "UPDATE stock_levels SET reserved=reserved-1 WHERE branch_id=$1 AND product_id=$2",
    [branch.id, product.id],
  );
  await f.reserve(cash, cashQuote);
  await insert("quote_revalidations", {
    quote_id: cashQuote.id,
    checked_by: staff.id,
    valid_until: new Date(Date.now() + 1800000).toISOString(),
    reason: "Test of unchanged price revalidation plus reacquired stock",
  });
  await f.confirm(cash);
  await db.exec("ROLLBACK");
  timeBoundaryChecks.push({
    id: "T02",
    passed: true,
    label:
      "Expired COD requires explicit unchanged-price revalidation and reacquired stock",
  });

  const { tables, columns, constraints, triggers } = await readCatalog(db);
  assert.equal(tables.length, 69);
  console.log(
    JSON.stringify(
      {
        scope:
          "Reference schema metadata and remaining service obligations only; no API/RBAC/concurrency/device claims.",
        engine: "PGlite PostgreSQL WASM",
        schemaSha256: createHash("sha256").update(schema).digest("hex"),
        tableCount: tables.length,
        tables,
        diagnosticCount: observations.length,
        observations,
        timeBoundaryChecks,
        columns,
        constraints,
        triggers,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
