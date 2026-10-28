// Reference SQL regression suite; no API, real-provider or multi-connection claims.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { makeFixture, schema } from "./helpers.mjs";

const f = await makeFixture();
const {
  db,
  insert,
  reject,
  branch,
  other,
  customer,
  otherCustomer,
  staff,
  courier,
  otherCourier,
  category,
  tires,
  viscosity,
  size,
  oilValue,
  sizeValue,
  product,
  product2,
  piece,
  carton,
  method,
  promotion,
  newOrder,
  newQuote,
  reserve,
  confirm,
  dispatch,
  media,
  transfer,
  review,
  cashDelivery,
} = f;
const results = [];
async function check(id, label, callback) {
  await db.exec("BEGIN");
  try {
    await callback();
    await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
    results.push({ id, label, passed: true });
    console.log("PASS", id, label);
  } finally {
    await db.exec("ROLLBACK");
  }
}
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const setStatus = (order, status) =>
  db.query("UPDATE orders SET status=$1 WHERE id=$2", [status, order.id]);

try {
  await check("S01", "negative stock rejected", () =>
    reject(() => db.query("UPDATE stock_levels SET on_hand=-1")),
  );
  await check("S02", "reserved cannot exceed stock", () =>
    reject(() => db.query("UPDATE stock_levels SET reserved=101")),
  );
  await check("S03", "piece conversion must equal one", () =>
    reject(() =>
      insert("product_units", {
        product_id: product2.id,
        unit_kind: "piece",
        pieces_per_unit: 2,
        price_yer: 1,
      }),
    ),
  );
  await check("S04", "carton conversion must exceed one", () =>
    reject(() =>
      insert("product_units", {
        product_id: product2.id,
        unit_kind: "carton",
        pieces_per_unit: 1,
        price_yer: 1,
      }),
    ),
  );
  await check("S05", "value belongs to correct attribute", () =>
    reject(() =>
      insert("product_attribute_values", {
        product_id: product2.id,
        category_id: category.id,
        attribute_id: viscosity.id,
        value_id: sizeValue.id,
      }),
    ),
  );
  await check("S06", "tire attribute not allowed for oil", () =>
    reject(() =>
      insert("product_attribute_values", {
        product_id: product2.id,
        category_id: category.id,
        attribute_id: size.id,
        value_id: sizeValue.id,
      }),
    ),
  );
  await check("S07", "product cannot pretend another category", () =>
    reject(() =>
      insert("product_attribute_values", {
        product_id: product2.id,
        category_id: tires.id,
        attribute_id: size.id,
        value_id: sizeValue.id,
      }),
    ),
  );
  await check("S08", "quote total arithmetic", async () => {
    const o = await newOrder();
    await reject(() => newQuote(o, { total_yer: 1 }));
  });
  await check("S09", "accepted quote requires owner identity", async () => {
    const o = await newOrder();
    const q = await newQuote(o, { accept: false });
    await reject(() =>
      db.query("UPDATE order_quotes SET status='accepted' WHERE id=$1", [q.id]),
    );
  });
  await check("S10", "quantity positive", async () => {
    const o = await newOrder();
    await reject(() =>
      newQuote(o, { send: false, line: { quantity: 0, line_total_yer: 0 } }),
    );
  });
  await check("S11", "line arithmetic", async () => {
    const o = await newOrder();
    await reject(() =>
      newQuote(o, { send: false, line: { line_total_yer: 1 } }),
    );
  });
  await check("S12", "unit belongs to product", async () => {
    const o = await newOrder();
    await reject(() =>
      newQuote(o, { send: false, line: { product_id: product2.id } }),
    );
  });
  await check(
    "S13",
    "reservation branch belongs to historical quote",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await reject(() =>
        insert("stock_reservations", {
          order_id: o.id,
          quote_id: q.id,
          branch_id: other.id,
          product_id: product.id,
          pieces: 1,
          expires_at: q.expires_at,
        }),
      );
    },
  );
  await check("S14", "one active assignment", async () => {
    const o = await newOrder();
    const q = await newQuote(o);
    await reserve(o, q);
    await confirm(o);
    await dispatch(o, q);
    await reject(() => dispatch(o, q));
  });
  await check("S15", "commission uses pre-discount delivery", async () => {
    const o = await newOrder();
    const q = await newQuote(o);
    await reserve(o, q);
    await confirm(o);
    await reject(() =>
      insert("order_assignments", {
        order_id: o.id,
        courier_id: courier.id,
        assigned_by: staff.id,
        commission_bps: 2000,
        delivery_fee_before_discount_yer: 400,
        delivery_discount_yer: 0,
        commission_yer: 1,
      }),
    );
  });
  await check("S16", "one delivery earning", async () => {
    const x = await cashDelivery();
    await reject(() =>
      insert("courier_earnings", {
        courier_id: courier.id,
        order_id: x.order.id,
        assignment_id: x.assignment.id,
        entry_type: "delivery",
        amount_yer: x.earning.amount_yer,
      }),
    );
  });
  await check("S17", "earning allocation cannot be paid twice", async () => {
    const x = await cashDelivery();
    const h = await insert("courier_settlements", {
      courier_id: courier.id,
      paid_by: staff.id,
      total_yer: x.earning.amount_yer,
      reference: "TEST",
    });
    await insert("settlement_items", {
      settlement_id: h.id,
      earning_id: x.earning.id,
    });
    await reject(() =>
      insert("settlement_items", {
        settlement_id: h.id,
        earning_id: x.earning.id,
      }),
    );
  });
  await check("S18", "financial ledger immutable", async () => {
    const x = await cashDelivery();
    await reject(() =>
      db.query("UPDATE courier_earnings SET amount_yer=1 WHERE id=$1", [
        x.earning.id,
      ]),
    );
  });
  await check("S19", "inventory ledger immutable", async () => {
    const m = await insert("stock_movements", {
      branch_id: branch.id,
      product_id: product.id,
      delta_pieces: 1,
      reason: "receipt",
      actor_id: staff.id,
    });
    await reject(() =>
      db.query("DELETE FROM stock_movements WHERE id=$1", [m.id]),
    );
  });
  await check("S20", "sale movement unique per order/product", async () => {
    const o = await newOrder();
    const data = {
      branch_id: branch.id,
      product_id: product.id,
      delta_pieces: -1,
      reason: "sale",
      actor_id: staff.id,
      order_id: o.id,
    };
    await insert("stock_movements", data);
    await reject(() => insert("stock_movements", data));
  });
  await check("S21", "canonical Yemen phone format", () =>
    reject(() =>
      insert("users", {
        phone_e164: "+971777777777",
        name_ar: "TEST",
        password_hash: "TEST",
        kind: "customer",
      }),
    ),
  );
  await check("S22", "minimum build cannot exceed latest", () =>
    reject(() =>
      insert("app_releases", {
        app: "customer",
        platform: "ios",
        environment: "staging",
        minimum_build: 5,
        latest_build: 4,
        latest_version: "TEST",
        store_url: "https://example.com",
      }),
    ),
  );

  await check("O01", "2800m bills 2km; 300 + 2*50 = 400", async () => {
    const o = await newOrder();
    const q = await newQuote(o);
    assert.equal(q.billed_km, 2);
    assert.equal(Number(q.delivery_yer), 400);
  });
  await check("O02", "sub-kilometre route charges base only", async () => {
    const o = await newOrder();
    const q = await newQuote(o, {
      distance_m: 999,
      delivery_yer: 300,
      total_yer: 5300,
    });
    assert.equal(q.billed_km, 0);
    assert.equal(Number(q.delivery_yer), 300);
  });
  await check("O03", "rounded-up fee rejected", async () => {
    const o = await newOrder();
    await reject(() => newQuote(o, { delivery_yer: 450, total_yer: 5450 }));
  });
  await check("O04", "manual route fee needs reason", async () => {
    const o = await newOrder();
    await reject(() =>
      newQuote(o, { pricing_mode: "manual", distance_m: null, reason: null }),
    );
    const q = await newQuote(o, {
      pricing_mode: "manual",
      distance_m: null,
      reason: "تعذر الطريق؛ مثال مراجعة",
      delivery_yer: 777,
      total_yer: 5777,
    });
    assert.equal(Number(q.delivery_yer), 777);
  });
  await check(
    "O05",
    "500 delivery less 100 discount at 20% earns 100",
    async () => {
      const x = await cashDelivery({
        distance_m: 4000,
        delivery_yer: 500,
        delivery_discount_yer: 100,
        total_yer: 5400,
      });
      assert.equal(Number(x.assignment.commission_yer), 100);
      assert.equal(Number(x.assignment.customer_delivery_yer), 400);
      assert.equal(Number(x.earning.amount_yer), 100);
    },
  );
  await check(
    "O06",
    "COD confirms with no receipt or transfer and records no cash automatically",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await reserve(o, q);
      await confirm(o);
      assert.equal(
        (await row("SELECT status FROM orders WHERE id=$1", [o.id])).status,
        "confirmed",
      );
      assert.equal(
        Number(
          (
            await row("SELECT count(*) AS n FROM payments WHERE order_id=$1", [
              o.id,
            ])
          ).n,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await row(
              "SELECT count(*) AS n FROM cash_collections WHERE order_id=$1",
              [o.id],
            )
          ).n,
        ),
        0,
      );
    },
  );
  await check(
    "O07",
    "transfer cannot confirm without verified money",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      await reject(() => confirm(o));
    },
  );
  await check(
    "O08",
    "receipt upload alone does not allow confirmation",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      await transfer(o, q);
      await reject(() => confirm(o));
    },
  );
  await check(
    "O09",
    "exact verified transfer permits confirmation",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      const t = await transfer(o, q);
      await review(t.payment, t.attempt);
      await confirm(o);
    },
  );
  await check(
    "O10",
    "underpayment and overpayment do not confirm",
    async () => {
      for (const amount of [5300, 5500]) {
        const o = await newOrder({ payment_kind: "transfer" });
        const q = await newQuote(o);
        await reserve(o, q);
        const t = await transfer(o, q, { amount });
        await review(t.payment, t.attempt);
        await reject(() => confirm(o));
      }
    },
  );
  await check(
    "O11",
    "one promotion cannot discount products and delivery together",
    async () => {
      const o = await newOrder();
      await reject(() =>
        newQuote(o, {
          product_discount_yer: 10,
          delivery_discount_yer: 10,
          total_yer: 5380,
        }),
      );
    },
  );
  await check(
    "O12",
    "discount requires a single promotion snapshot",
    async () => {
      const o = await newOrder();
      await reject(() =>
        newQuote(o, {
          delivery_discount_yer: 10,
          promotion_id: null,
          promotion_snapshot: null,
        }),
      );
    },
  );
  await check(
    "O13",
    "manager-selected execution branch is distinct from catalog branch",
    async () => {
      const o = await newOrder({ unassigned: true });
      assert.equal(o.branch_id, null);
      const previewOrderCount = Number(
        (await row("SELECT count(*) AS n FROM order_quotes")).n,
      );
      assert.equal(previewOrderCount, 0);
      await db.query(
        "UPDATE orders SET branch_id=$1,branch_selected_by=$2,branch_selected_at=now() WHERE id=$3",
        [other.id, staff.id, o.id],
      );
      const q = await newQuote({ ...o, branch_id: other.id });
      assert.equal(q.branch_id, other.id);
      assert.equal(
        (await row("SELECT catalog_branch_id FROM orders WHERE id=$1", [o.id]))
          .catalog_branch_id,
        branch.id,
      );
    },
  );
  await check(
    "O14",
    "branch change retains old reservation and acceptance; equal total needs fresh acceptance",
    async () => {
      const o = await newOrder();
      const q1 = await newQuote(o);
      const r = await reserve(o, q1);
      await db.query(
        "UPDATE stock_reservations SET state='released' WHERE id=$1",
        [r.id],
      );
      await db.query(
        "UPDATE stock_levels SET reserved=reserved-1 WHERE branch_id=$1 AND product_id=$2",
        [branch.id, product.id],
      );
      await db.query(
        "UPDATE order_quotes SET status='superseded' WHERE id=$1",
        [q1.id],
      );
      await db.query("UPDATE orders SET branch_id=$1 WHERE id=$2", [
        other.id,
        o.id,
      ]);
      const q2 = await newQuote(
        { ...o, branch_id: other.id },
        { revision: 2, accept: false },
      );
      await reserve(o, q2);
      await reject(() => confirm(o));
      assert.equal(
        (
          await row("SELECT branch_id FROM stock_reservations WHERE id=$1", [
            r.id,
          ])
        ).branch_id,
        branch.id,
      );
      assert.equal(
        (await row("SELECT accepted_by FROM order_quotes WHERE id=$1", [q1.id]))
          .accepted_by,
        customer.id,
      );
      await db.query(
        "UPDATE order_quotes SET status='accepted',accepted_by=$1,accepted_at=now() WHERE id=$2",
        [customer.id, q2.id],
      );
      await confirm(o);
    },
  );
  await check("O15", "current quote FK belongs to order", async () => {
    const a = await newOrder();
    const b = await newOrder();
    const qb = await newQuote(b);
    await reject(async () => {
      await db.query("UPDATE orders SET current_quote_id=$1 WHERE id=$2", [
        qb.id,
        a.id,
      ]);
      await db.exec("SET CONSTRAINTS current_quote_belongs_to_order IMMEDIATE");
    });
  });
  await check("O16", "different customer cannot accept quote", async () => {
    const o = await newOrder();
    const q = await newQuote(o, { accept: false });
    await reject(() =>
      db.query(
        "UPDATE order_quotes SET status='accepted',accepted_by=$1,accepted_at=now() WHERE id=$2",
        [otherCustomer.id, q.id],
      ),
    );
  });
  await check(
    "O17",
    "sent quote lines and financial facts are immutable",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await reject(() =>
        db.query(
          "UPDATE quote_items SET quantity=2,line_total_yer=10000 WHERE quote_id=$1",
          [q.id],
        ),
      );
      await reject(() =>
        db.query("UPDATE order_quotes SET reason=$1 WHERE id=$2", [
          "silent edit",
          q.id,
        ]),
      );
    },
  );
  await check(
    "O18",
    "draft lines editable, subtotal checked when sent",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o, { send: false });
      await db.query(
        "UPDATE quote_items SET quantity=2,line_total_yer=10000 WHERE quote_id=$1",
        [q.id],
      );
      await reject(() =>
        db.query("UPDATE order_quotes SET status='sent' WHERE id=$1", [q.id]),
      );
      await db.query(
        "UPDATE order_quotes SET subtotal_yer=10000,total_yer=10400 WHERE id=$1",
        [q.id],
      );
      await db.query("UPDATE order_quotes SET status='sent' WHERE id=$1", [
        q.id,
      ]);
    },
  );
  await check(
    "O19",
    "used carton conversion cannot change; archive allowed",
    async () => {
      const o = await newOrder();
      await newQuote(o, {
        subtotal_yer: 58000,
        total_yer: 58400,
        line: {
          unit_id: carton.id,
          unit_snapshot: "كرتون",
          pieces_per_unit: 12,
          unit_price_yer: 58000,
          line_total_yer: 58000,
        },
      });
      await reject(() =>
        db.query("UPDATE product_units SET pieces_per_unit=24 WHERE id=$1", [
          carton.id,
        ]),
      );
      await db.query(
        "UPDATE product_units SET active=false,archived_at=now() WHERE id=$1",
        [carton.id],
      );
    },
  );
  await check(
    "O20",
    "historical acceptance survives superseded/expired",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await db.query("UPDATE order_quotes SET status='expired' WHERE id=$1", [
        q.id,
      ]);
      const kept = await row(
        "SELECT accepted_by,accepted_at FROM order_quotes WHERE id=$1",
        [q.id],
      );
      assert.equal(kept.accepted_by, customer.id);
      assert.ok(kept.accepted_at);
      await reject(() =>
        db.query(
          "UPDATE order_quotes SET accepted_by=NULL,accepted_at=NULL WHERE id=$1",
          [q.id],
        ),
      );
    },
  );
  await check(
    "O21",
    "rejected image reupload preserves single transfer and all attempts",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      const t = await transfer(o, q);
      await review(t.payment, t.attempt, "image_rejected");
      const m = await media();
      const a2 = await insert("payment_receipt_attempts", {
        payment_id: t.payment.id,
        attempt_number: 2,
        media_id: m.id,
        submitted_by: customer.id,
      });
      await review(t.payment, a2);
      assert.equal(
        Number(
          (
            await row("SELECT count(*) AS n FROM payments WHERE order_id=$1", [
              o.id,
            ])
          ).n,
        ),
        1,
      );
      assert.equal(
        Number(
          (
            await row(
              "SELECT count(*) AS n FROM payment_receipt_attempts WHERE payment_id=$1",
              [t.payment.id],
            )
          ).n,
        ),
        2,
      );
      assert.equal(
        Number(
          (
            await row(
              "SELECT count(*) AS n FROM payment_receipt_reviews WHERE payment_id=$1",
              [t.payment.id],
            )
          ).n,
        ),
        2,
      );
      await reject(() => review(t.payment, a2));
      await confirm(o);
    },
  );
  await check(
    "O22",
    "same transfer reference cannot fund another order",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      await transfer(o, q, { receipt: "DUPLICATE_TEST" });
      const b = await newOrder({ payment_kind: "transfer" });
      const qb = await newQuote(b);
      await reserve(b, qb);
      await reject(() => transfer(b, qb, { receipt: "DUPLICATE_TEST" }));
    },
  );
  await check(
    "O23",
    "wallet edit does not rewrite frozen transfer destination",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      const t = await transfer(o, q);
      await db.query(
        "UPDATE payment_methods SET destination_number=$1 WHERE id=$2",
        ["NEW_TEST_DESTINATION", method.id],
      );
      const frozen = await row(
        "SELECT method_snapshot FROM payment_instructions WHERE id=$1",
        [t.instruction.id],
      );
      assert.equal(frozen.method_snapshot.destination_number, "TEST_ONLY");
      await reject(() =>
        db.query(
          "UPDATE payment_instructions SET method_snapshot='{}' WHERE id=$1",
          [t.instruction.id],
        ),
      );
    },
  );
  await check(
    "O24",
    "receipt protects stock without an automatic expiry and prevents repricing",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      const r = await reserve(o, q);
      const t = await transfer(o, q);
      let held = await row("SELECT * FROM stock_reservations WHERE id=$1", [
        r.id,
      ]);
      assert.equal(held.hold_kind, "receipt_review");
      assert.equal(held.expires_at, null);
      await reject(() =>
        db.query("UPDATE stock_reservations SET state='expired' WHERE id=$1", [
          r.id,
        ]),
      );
      await reject(() =>
        db.query("UPDATE order_quotes SET status='superseded' WHERE id=$1", [
          q.id,
        ]),
      );
      await reject(() =>
        db.query("UPDATE stock_reservations SET state='released' WHERE id=$1", [
          r.id,
        ]),
      );
      await review(t.payment, t.attempt, "image_rejected");
      held = await row("SELECT * FROM stock_reservations WHERE id=$1", [r.id]);
      assert.equal(held.state, "active");
      assert.equal(held.expires_at, null);
    },
  );
  await check(
    "O25",
    "expired initial stock hold cannot confirm COD",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await reserve(o, q, { expires_at: "2000-01-01T00:00:00Z" });
      await reject(() => confirm(o));
    },
  );
  await check(
    "O26",
    "confirmed order branch/amount source frozen; cancellation blocked",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await reserve(o, q);
      await confirm(o);
      await reject(() =>
        db.query("UPDATE orders SET branch_id=$1 WHERE id=$2", [
          other.id,
          o.id,
        ]),
      );
      await reject(() => setStatus(o, "cancelled"));
    },
  );
  await check(
    "O27",
    "cancel before confirmation without receipt permitted",
    async () => {
      const o = await newOrder();
      await setStatus(o, "cancelled");
    },
  );
  await check(
    "O28",
    "cancellation after receipt requires documented admin decision",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      await transfer(o, q);
      await reject(() => setStatus(o, "cancelled"));
    },
  );
  await check("O29", "delivery does not invent a cash collection", async () => {
    const o = await newOrder();
    const q = await newQuote(o);
    await reserve(o, q);
    await confirm(o);
    await dispatch(o, q);
    await setStatus(o, "on_the_way");
    await reject(() => setStatus(o, "delivered"));
    assert.equal(
      Number(
        (
          await row(
            "SELECT count(*) AS n FROM cash_collections WHERE order_id=$1",
            [o.id],
          )
        ).n,
      ),
      0,
    );
    await insert("financial_exceptions", {
      order_id: o.id,
      kind: "cash_uncollected",
      amount_yer: q.total_yer,
      reason: "تعذر تحصيل موثق للاختبار",
      opened_by: staff.id,
    });
    await setStatus(o, "delivered");
  });
  await check(
    "O30",
    "cash collection, remittance and commission use separate ledgers",
    async () => {
      const x = await cashDelivery();
      assert.equal(Number(x.collection.amount_yer), 5400);
      assert.equal(Number(x.earning.amount_yer), 80);
      const h = await insert("cash_remittances", {
        courier_id: courier.id,
        received_by: staff.id,
        total_yer: 5400,
        reference: "TEST_REMIT",
      });
      await insert("cash_remittance_items", {
        remittance_id: h.id,
        collection_id: x.collection.id,
      });
      await reject(() =>
        insert("cash_remittance_items", {
          remittance_id: h.id,
          collection_id: x.collection.id,
        }),
      );
      assert.equal(
        Number((await row("SELECT count(*) AS n FROM settlement_items")).n),
        0,
      );
    },
  );
  await check(
    "O31",
    "earning must match assignment courier/order/amount and delivery",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await reserve(o, q);
      await confirm(o);
      const a = await dispatch(o, q);
      await reject(() =>
        insert("courier_earnings", {
          courier_id: courier.id,
          order_id: o.id,
          assignment_id: a.id,
          entry_type: "delivery",
          amount_yer: a.commission_yer,
        }),
      );
    },
  );
  await check(
    "O32",
    "settlement requires same courier and exact total",
    async () => {
      const x = await cashDelivery();
      await reject(async () => {
        const h = await insert("courier_settlements", {
          courier_id: otherCourier.id,
          paid_by: staff.id,
          total_yer: 80,
          reference: "WRONG_OWNER",
        });
        await insert("settlement_items", {
          settlement_id: h.id,
          earning_id: x.earning.id,
        });
      });
      await reject(async () => {
        const h = await insert("courier_settlements", {
          courier_id: courier.id,
          paid_by: staff.id,
          total_yer: 1,
          reference: "WRONG_TOTAL",
        });
        await insert("settlement_items", {
          settlement_id: h.id,
          earning_id: x.earning.id,
        });
        await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
      });
    },
  );
  await check(
    "O33",
    "reversal creates one reusable credit, keeps original allocation and never re-earns commission",
    async () => {
      const x = await cashDelivery();
      const h = await insert("courier_settlements", {
        courier_id: courier.id,
        paid_by: staff.id,
        total_yer: 80,
        reference: "ORIGINAL",
      });
      await insert("settlement_items", {
        settlement_id: h.id,
        earning_id: x.earning.id,
      });
      const proof = await media("complaint");
      const data = {
        settlement_id: h.id,
        courier_id: courier.id,
        amount_yer: 80,
        reason: "عكس موثق للاختبار",
        reference: "REVERSAL",
        proof_media_id: proof.id,
        actor_id: staff.id,
      };
      const rev = await insert("courier_settlement_reversals", data);
      await reject(() => insert("courier_settlement_reversals", data));
      const h2 = await insert("courier_settlements", {
        courier_id: courier.id,
        paid_by: staff.id,
        total_yer: 80,
        reference: "REPAY",
      });
      await insert("settlement_items", {
        settlement_id: h2.id,
        reversal_credit_id: rev.id,
      });
      await reject(() =>
        insert("settlement_items", {
          settlement_id: h2.id,
          reversal_credit_id: rev.id,
        }),
      );
      assert.equal(
        Number(
          (
            await row(
              "SELECT count(*) AS n FROM courier_earnings WHERE order_id=$1",
              [x.order.id],
            )
          ).n,
        ),
        1,
      );
      assert.equal(
        Number(
          (
            await row(
              "SELECT count(*) AS n FROM settlement_items WHERE earning_id=$1",
              [x.earning.id],
            )
          ).n,
        ),
        1,
      );
    },
  );
  await check(
    "O34",
    "financial resolution requires amount/reason/reference/evidence/actor/date",
    async () => {
      const o = await newOrder();
      const e = await insert("financial_exceptions", {
        order_id: o.id,
        kind: "late_transfer",
        amount_yer: 100,
        reason: "تحويل متأخر اختبار",
        opened_by: staff.id,
      });
      await reject(() =>
        insert("financial_exception_resolutions", {
          exception_id: e.id,
          direction: "refund_to_customer",
          amount_yer: 100,
          reason: "TEST",
          reference: "TEST",
          actor_id: staff.id,
          occurred_at: new Date().toISOString(),
        }),
      );
    },
  );
  await check("O35", "NULL coverage cannot enable delivery", async () => {
    await reject(() =>
      db.query("UPDATE branches SET delivery_enabled=true WHERE id=$1", [
        branch.id,
      ]),
    );
    await db.query("UPDATE branches SET coverage_radius_m=50000 WHERE id=$1", [
      branch.id,
    ]);
    await reject(() =>
      db.query("UPDATE branches SET delivery_enabled=true WHERE id=$1", [
        branch.id,
      ]),
    );
    await insert("delivery_rules", {
      branch_id: branch.id,
      base_yer: 300,
      per_km_yer: 50,
      max_distance_m: 60000,
    });
    await db.query("UPDATE branches SET delivery_enabled=true WHERE id=$1", [
      branch.id,
    ]);
    await reject(() =>
      db.query(
        "UPDATE delivery_rules SET max_distance_m=NULL WHERE branch_id=$1",
        [branch.id],
      ),
    );
  });
  await check(
    "O36",
    "catalog branch pointer belongs to chosen governorate",
    async () => {
      const g = await insert("governorates", {
        name_ar: "محافظة أخرى للاختبار",
      });
      await reject(() =>
        db.query("UPDATE governorates SET catalog_branch_id=$1 WHERE id=$2", [
          branch.id,
          g.id,
        ]),
      );
    },
  );
  await check(
    "O37",
    "privacy redacts personal snapshot without editing financial ledger",
    async () => {
      const x = await cashDelivery();
      await reject(() =>
        db.query(
          "UPDATE order_private_details SET address_snapshot='{}' WHERE id=$1",
          [x.order.detailsId],
        ),
      );
      await db.query(
        "UPDATE order_private_details SET address_snapshot='{}',contact_snapshot='{}',redacted_at=now(),redacted_by=$1,redaction_reason='Approved-policy test only' WHERE id=$2",
        [staff.id, x.order.detailsId],
      );
      assert.equal(
        Number(
          (
            await row("SELECT amount_yer FROM courier_earnings WHERE id=$1", [
              x.earning.id,
            ])
          ).amount_yer,
        ),
        80,
      );
      await reject(() =>
        db.query(
          "UPDATE order_private_details SET address_snapshot=$1::jsonb WHERE id=$2",
          [JSON.stringify({ restored: true }), x.order.detailsId],
        ),
      );
    },
  );
  await check("O38", "cash ledger cannot collect transfer order", async () => {
    const o = await newOrder({ payment_kind: "transfer" });
    const q = await newQuote(o);
    await reserve(o, q);
    const t = await transfer(o, q);
    await review(t.payment, t.attempt);
    await confirm(o);
    const a = await dispatch(o, q);
    await reject(() =>
      insert("cash_collections", {
        order_id: o.id,
        assignment_id: a.id,
        courier_id: courier.id,
        amount_yer: 5400,
        reference: "WRONG_KIND",
        recorded_by: courier.id,
        collected_at: new Date().toISOString(),
      }),
    );
  });
  await check(
    "O39",
    "cash remittance cannot silently deduct courier commission",
    async () => {
      const x = await cashDelivery();
      await reject(async () => {
        const h = await insert("cash_remittances", {
          courier_id: courier.id,
          received_by: staff.id,
          total_yer: 5320,
          reference: "NO_NETTING",
        });
        await insert("cash_remittance_items", {
          remittance_id: h.id,
          collection_id: x.collection.id,
        });
        await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
      });
    },
  );
  await check("O40", "audit history remains immutable", async () => {
    const a = await insert("audit_logs", {
      actor_id: staff.id,
      action: "TEST",
      entity_type: "TEST",
      request_id: randomUUID(),
    });
    await reject(() => db.query("DELETE FROM audit_logs WHERE id=$1", [a.id]));
  });
  await check(
    "O41",
    "two cartons plus three pieces consume 27 and stock 26 rejects",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o, {
        send: false,
        subtotal_yer: 131000,
        total_yer: 131400,
        line: {
          unit_id: carton.id,
          unit_snapshot: "كرتون",
          pieces_per_unit: 12,
          quantity: 2,
          unit_price_yer: 58000,
          line_total_yer: 116000,
        },
      });
      await insert("quote_items", {
        quote_id: q.id,
        product_id: product.id,
        unit_id: piece.id,
        name_snapshot: "TEST",
        unit_snapshot: "حبة",
        pieces_per_unit: 1,
        quantity: 3,
        unit_price_yer: 5000,
        line_total_yer: 15000,
      });
      await db.query("UPDATE order_quotes SET status='sent' WHERE id=$1", [
        q.id,
      ]);
      assert.equal(
        Number(
          (
            await row(
              "SELECT sum(quantity::bigint*pieces_per_unit) AS n FROM quote_items WHERE quote_id=$1",
              [q.id],
            )
          ).n,
        ),
        27,
      );
      await db.query("UPDATE stock_levels SET on_hand=26 WHERE branch_id=$1", [
        branch.id,
      ]);
      await reject(() => reserve(o, q, { pieces: 27 }));
    },
  );

  await check(
    "O42",
    "quote revalidation preserves immutable price and acceptance",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      const checkRecord = await insert("quote_revalidations", {
        quote_id: q.id,
        checked_by: staff.id,
        valid_until: new Date(Date.now() + 1800000).toISOString(),
        reason: "Unchanged price and stock rechecked; test only",
      });
      await reject(() =>
        db.query("UPDATE quote_revalidations SET reason=$1 WHERE id=$2", [
          "rewrite",
          checkRecord.id,
        ]),
      );
      await reject(() =>
        db.query(
          "UPDATE order_quotes SET delivery_yer=500,total_yer=5500 WHERE id=$1",
          [q.id],
        ),
      );
    },
  );
  await check(
    "O43",
    "financial exception cannot close without documented resolution",
    async () => {
      const o = await newOrder();
      const e = await insert("financial_exceptions", {
        order_id: o.id,
        kind: "late_transfer",
        amount_yer: 100,
        reason: "TEST",
        opened_by: staff.id,
      });
      await reject(() =>
        db.query(
          "UPDATE financial_exceptions SET status='resolved' WHERE id=$1",
          [e.id],
        ),
      );
    },
  );
  await check(
    "O44",
    "overpayment resolved externally yields exact net without editing approved money",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      const t = await transfer(o, q, { amount: 5500 });
      await review(t.payment, t.attempt);
      const e = await insert("financial_exceptions", {
        order_id: o.id,
        kind: "overpayment",
        amount_yer: 100,
        reason: "TEST_OVERPAYMENT",
        opened_by: staff.id,
      });
      const proof = await media("complaint");
      await insert("financial_exception_resolutions", {
        exception_id: e.id,
        direction: "refund_to_customer",
        amount_yer: 100,
        reason: "External test refund",
        reference: "TEST_REFUND",
        proof_media_id: proof.id,
        actor_id: staff.id,
        occurred_at: new Date().toISOString(),
      });
      await db.query(
        "UPDATE financial_exceptions SET status='resolved' WHERE id=$1",
        [e.id],
      );
      await confirm(o);
      assert.equal(
        Number(
          (
            await row("SELECT approved_amount_yer FROM payments WHERE id=$1", [
              t.payment.id,
            ])
          ).approved_amount_yer,
        ),
        5500,
      );
    },
  );
  await check(
    "O45",
    "partial cash remains the actual amount and delivery needs a shortfall exception",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await reserve(o, q);
      await confirm(o);
      const a = await dispatch(o, q);
      await setStatus(o, "on_the_way");
      await insert("cash_collections", {
        order_id: o.id,
        assignment_id: a.id,
        courier_id: courier.id,
        amount_yer: 5000,
        reference: "PARTIAL_TEST",
        recorded_by: courier.id,
        collected_at: new Date().toISOString(),
      });
      await reject(() => setStatus(o, "delivered"));
      await insert("financial_exceptions", {
        order_id: o.id,
        kind: "cash_shortfall",
        amount_yer: 400,
        reason: "TEST_SHORTFALL",
        opened_by: staff.id,
      });
      await setStatus(o, "delivered");
      assert.equal(
        Number(
          (
            await row(
              "SELECT sum(amount_yer) AS n FROM cash_collections WHERE order_id=$1",
              [o.id],
            )
          ).n,
        ),
        5000,
      );
    },
  );
  await check(
    "O46",
    "cash remittance cannot allocate another courier collection",
    async () => {
      const x = await cashDelivery();
      await reject(async () => {
        const h = await insert("cash_remittances", {
          courier_id: otherCourier.id,
          received_by: staff.id,
          total_yer: 5400,
          reference: "WRONG_OWNER",
        });
        await insert("cash_remittance_items", {
          remittance_id: h.id,
          collection_id: x.collection.id,
        });
      });
    },
  );
  await check(
    "O47",
    "cash reversal preserves original remittance and reallocates one credit only",
    async () => {
      const x = await cashDelivery();
      const h = await insert("cash_remittances", {
        courier_id: courier.id,
        received_by: staff.id,
        total_yer: 5400,
        reference: "ORIGINAL_CASH",
      });
      await insert("cash_remittance_items", {
        remittance_id: h.id,
        collection_id: x.collection.id,
      });
      const proof = await media("complaint");
      const data = {
        remittance_id: h.id,
        courier_id: courier.id,
        amount_yer: 5400,
        actor_id: staff.id,
        reason: "TEST_REVERSAL",
        reference: "TEST_REVERSAL",
        proof_media_id: proof.id,
      };
      const rev = await insert("cash_remittance_reversals", data);
      await reject(() => insert("cash_remittance_reversals", data));
      const h2 = await insert("cash_remittances", {
        courier_id: courier.id,
        received_by: staff.id,
        total_yer: 5400,
        reference: "REMIT_AGAIN",
      });
      await insert("cash_remittance_items", {
        remittance_id: h2.id,
        reversal_credit_id: rev.id,
      });
      await reject(() =>
        insert("cash_remittance_items", {
          remittance_id: h2.id,
          reversal_credit_id: rev.id,
        }),
      );
      assert.equal(
        Number(
          (
            await row(
              "SELECT count(*) AS n FROM cash_remittance_items WHERE collection_id=$1",
              [x.collection.id],
            )
          ).n,
        ),
        1,
      );
    },
  );
  await check(
    "O48",
    "delivery must be disabled before rule removal",
    async () => {
      await db.query(
        "UPDATE branches SET coverage_radius_m=50000 WHERE id=$1",
        [branch.id],
      );
      await insert("delivery_rules", {
        branch_id: branch.id,
        base_yer: 300,
        per_km_yer: 50,
        max_distance_m: 60000,
      });
      await db.query("UPDATE branches SET delivery_enabled=true WHERE id=$1", [
        branch.id,
      ]);
      await reject(() =>
        db.query("DELETE FROM delivery_rules WHERE branch_id=$1", [branch.id]),
      );
    },
  );
  await check(
    "O49",
    "receipt attempts preserve owner/privacy and sequential reviewed history",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      const t = await transfer(o, q);
      const m = await media();
      await reject(() =>
        insert("payment_receipt_attempts", {
          payment_id: t.payment.id,
          attempt_number: 2,
          media_id: m.id,
          submitted_by: otherCustomer.id,
        }),
      );
      await reject(() =>
        insert("payment_receipt_attempts", {
          payment_id: t.payment.id,
          attempt_number: 2,
          media_id: m.id,
          submitted_by: customer.id,
        }),
      );
      await reject(() =>
        db.query(
          "UPDATE payments SET status=$1,reviewer_id=$2,reviewed_at=now(),approved_amount_yer=5400 WHERE id=$3",
          ["approved", staff.id, t.payment.id],
        ),
      );
    },
  );

  await check(
    "O50",
    "protected transfer cannot be bypassed by changing current quote or branch",
    async () => {
      const o = await newOrder({ payment_kind: "transfer" });
      const q = await newQuote(o);
      await reserve(o, q);
      await transfer(o, q);
      await reject(() =>
        db.query("UPDATE orders SET branch_id=$1 WHERE id=$2", [
          other.id,
          o.id,
        ]),
      );
      await reject(() => newQuote(o, { revision: 2 }));
    },
  );

  await check(
    "O51",
    "confirmed acceptance and confirmation timestamp remain historical",
    async () => {
      const o = await newOrder();
      const q = await newQuote(o);
      await reserve(o, q);
      await confirm(o);
      await reject(() =>
        db.query("UPDATE order_quotes SET status='superseded' WHERE id=$1", [
          q.id,
        ]),
      );
      await reject(() =>
        db.query(
          "UPDATE orders SET confirmed_at=confirmed_at+interval '1 day' WHERE id=$1",
          [o.id],
        ),
      );
    },
  );

  const tables = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  const summary = {
    scope:
      "Reference SQL constraints/triggers only; no API, authorization, real-provider, multi-connection or device tests.",
    engine: "PGlite PostgreSQL WASM",
    schemaSha256: createHash("sha256").update(schema).digest("hex"),
    tableCount: tables.length,
    tables,
    passed: results.length,
    results,
  };
  assert.equal(tables.length, 69);
  console.log(JSON.stringify(summary));
} finally {
  await db.close();
}
