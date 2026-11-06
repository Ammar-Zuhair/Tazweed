import { test } from "node:test";
import assert from "node:assert/strict";
for (const app of ["customer", "admin", "courier"]) {
  const { OperationQueue } = await import(
    `../../${app}-app/src/live/operation-queue.ts`
  );
  test(`${app}: native persistence delay cannot turn a double tap into two submission keys`, async () => {
    let release!: () => void,
      sends = 0,
      keys = 0,
      saved: any = null;
    const wait = new Promise<void>((r) => (release = r));
    const queue = new OperationQueue(
      {
        read: async () => null,
        write: async (c: any) => {
          saved = c;
          await wait;
        },
        remove: async () => {
          saved = null;
        },
      },
      async (c: any) => {
        sends++;
        return { id: "real-ack", key: c.key };
      },
      () => String(++keys),
    );
    await queue.restore();
    const first = queue.execute("/orders", { quantity: 3 });
    assert.equal(queue.snapshot().busy, true);
    await assert.rejects(queue.execute("/orders", { quantity: 3 }));
    assert.equal(keys, 1);
    assert.equal(sends, 0);
    release();
    assert.equal((await first).id, "real-ack");
    assert.equal(sends, 1);
    assert.equal(saved, null);
    assert.equal(queue.snapshot().command, null);
  });
  test(`${app}: lost acknowledgement persists content/key across controller recreation and retries the same operation`, async () => {
    let saved: any = null,
      calls = 0;
    const keys: string[] = [];
    const storage = {
      read: async () => saved,
      write: async (c: any) => {
        saved = JSON.parse(JSON.stringify(c));
      },
      remove: async () => {
        saved = null;
      },
    };
    const send = async (c: any) => {
      keys.push(c.key);
      calls++;
      if (calls === 1) throw Error("Acknowledgement lost after commit");
      return { id: "committed-order" };
    };
    const first = new OperationQueue(storage, send, () => "original-key");
    await first.restore();
    await assert.rejects(first.execute("/orders", { quantity: 3 }));
    assert.equal(saved.key, "original-key");
    const restored = new OperationQueue(
      storage,
      send,
      () => "must-not-be-used",
    );
    await restored.restore();
    await assert.rejects(restored.execute("/orders", { quantity: 5 }));
    assert.equal(calls, 1);
    assert.equal((await restored.execute()).id, "committed-order");
    assert.deepEqual(keys, ["original-key", "original-key"]);
    assert.equal(saved, null);
  });
  test(`${app}: storage failure sends nothing; definite rejection clears while an unavailable service keeps the command`, async () => {
    let failing = true,
      sends = 0,
      status = 409,
      saved: any = null;
    const queue = new OperationQueue(
      {
        read: async () => null,
        write: async (c: any) => {
          if (failing) throw Error("Secure storage unavailable");
          saved = c;
        },
        remove: async () => {
          saved = null;
        },
      },
      async () => {
        sends++;
        throw Object.assign(Error("Rejected"), { status });
      },
      () => "same-key",
    );
    await queue.restore();
    await assert.rejects(queue.execute("/orders", { quantity: 1 }));
    assert.equal(sends, 0);
    assert(queue.snapshot().command);
    failing = false;
    await assert.rejects(queue.execute());
    assert.equal(queue.snapshot().command, null);
    assert.equal(saved, null);
    status = 503;
    await assert.rejects(queue.execute("/orders", { quantity: 2 }));
    assert(queue.snapshot().command);
    assert.equal(saved.body.quantity, 2);
  });
}
for (const app of ["customer", "admin", "courier"]) {
  const { OperationQueue } = await import(
    `../../${app}-app/src/live/operation-queue.ts`
  );
  test(`${app}: account erasure waits for a delayed native save, deletes it and prevents dispatch or resurrection`, async () => {
    let release!: () => void,
      saved: any = null,
      sends = 0;
    const delay = new Promise<void>((r) => {
      release = r;
    });
    const q = new OperationQueue(
      {
        read: async () => null,
        write: async (c: any) => {
          await delay;
          saved = c;
        },
        remove: async () => {
          saved = null;
        },
      },
      async () => {
        sends++;
      },
      () => "isolated-erase-key",
    );
    await q.restore();
    const pending = q.execute("/orders", { privateAddressId: "isolated-id" });
    const rejected = assert.rejects(pending, /مسح/);
    const erasing = q.erase();
    release();
    await rejected;
    await erasing;
    assert.equal(saved, null);
    assert.equal(sends, 0);
    assert.equal(q.snapshot().command, null);
    assert.equal(q.snapshot().ready, false);
    await assert.rejects(q.execute("/orders", {}));
  });
}
