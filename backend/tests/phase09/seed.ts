import { seed as seed08 } from "../phase08/seed.js";
import type { Fixture } from "../phase05/helpers.js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
export async function seed(f: Fixture, logins = true) {
  const h = await seed08(f, logins);
  const courier = await f.user("770009001", "courier"),
    other = await f.user("770009002", "courier");
  await f.owner.query(
    "UPDATE users SET name_ar=CASE WHEN id=$1 THEN 'موصل اختبار09' ELSE 'موصل آخر09' END WHERE id IN ($1,$2)",
    [courier.id, other.id],
  );
  await f.owner.query(
    "INSERT INTO courier_profiles(user_id,commission_bps) VALUES($1,2000),($2,2500)",
    [courier.id, other.id],
  );
  for (const cid of [courier.id, other.id])
    await f.owner.query(
      "INSERT INTO courier_branches(courier_id,branch_id) VALUES($1,$2),($1,$3)",
      [cid, h.b, h.b2],
    );
  let token = logins ? (await f.login(courier, "courier")).accessToken : "",
    otherToken = logins ? (await f.login(other, "courier")).accessToken : "",
    adminToken = h.admin;
  const req = (
    path: string,
    body?: any,
    admin = false,
    key = randomUUID(),
    method = body === undefined ? "GET" : "POST",
  ) =>
    f.request(
      method,
      "/api/v1" + path,
      body,
      admin ? adminToken : token,
      admin ? "admin" : "courier",
      { "Idempotency-Key": key },
    );
  const task = async (id: string) => {
    const r = await req("/courier/orders/" + id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const confirmed = async () => {
    const id = await h.submit();
    await h.quote(id);
    await h.accept(id);
    assert.equal((await h.confirm(id)).status, 200);
    return id;
  };
  const assign = async (id: string, courierId = courier.id) => {
    const r = await req(
      "/admin/orders/" + id + "/assign",
      {
        courierId,
        reason: "إسناد اختبار موثق",
        expectedVersion: (await h.get(id, true)).order.version,
      },
      true,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const cmd = async (
    id: string,
    path: string,
    extra: any = {},
    key = randomUUID(),
  ) =>
    req(
      "/courier/orders/" + id + "/" + path,
      { expectedVersion: (await task(id)).order.version, ...extra },
      false,
      key,
    );
  const delivered = async (cash = true) => {
    const id = await confirmed();
    await assign(id);
    assert.equal((await cmd(id, "start")).status, 200);
    if (cash)
      assert.equal(
        (
          await cmd(id, "cash-collections", {
            amountYer: "500",
            reference: randomUUID(),
            collectedAt: new Date().toISOString(),
          })
        ).status,
        200,
      );
    assert.equal((await cmd(id, "deliver")).status, 200);
    return id;
  };
  return {
    ...h,
    courier,
    other,
    token,
    otherToken,
    req,
    task,
    confirmed,
    assign,
    cmd,
    delivered,
    setTokens: (tokens: { customer?: string; admin?: string }) => {
      h.setTokens(tokens);
      if (tokens.admin) adminToken = tokens.admin;
    },
    setCourierTokens: (a: string, b = "") => {
      token = a;
      otherToken = b;
    },
  };
}
