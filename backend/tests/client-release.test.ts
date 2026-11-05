import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
for (const app of ["customer", "admin", "courier"]) {
  test(
    app +
      " release config separates channels/identity, rejects missing metadata and uses fingerprint + next launch policy",
    async () => {
      const old = process.cwd(),
        env = process.env.EXPO_PUBLIC_APP_ENV,
        path = await mkdtemp(join(tmpdir(), "tazweed-release10-"));
      try {
        const { default: config } = await import(
          "../../" + app + "-app/app.config.ts"
        );
        process.env.EXPO_PUBLIC_APP_ENV = "preview";
        const preview = config({ config: {} });
        assert.equal(preview.updates.enabled, false);
        assert.equal(preview.extra.dataMode, "backend");
        process.chdir(path);
        process.env.EXPO_PUBLIC_APP_ENV = "staging";
        assert.throws(() => config({ config: {} }), /not configured/);
        await mkdir(join(path, "integration"));
        const metadata = {
          environment: "staging",
          projectId: randomUUID(),
          apiUrl: "https://isolated.example/api/v1",
          androidPackage: "org.isolated." + app,
          iosBundleIdentifier: "org.isolated." + app,
        };
        await writeFile(
          join(path, "integration/release.staging.local.json"),
          JSON.stringify(metadata),
        );
        const native = config({ config: {} });
        assert.equal(native.runtimeVersion.policy, "fingerprint");
        assert.equal(native.updates.checkAutomatically, "NEVER");
        assert.equal(native.updates.fallbackToCacheTimeout, 0);
        assert.equal(native.extra.apiUrl, "https://isolated.example");
        assert.equal(native.android.package, metadata.androidPackage);
        assert.equal(native.extra.eas.projectId, metadata.projectId);
        process.env.EXPO_PUBLIC_APP_ENV = "production";
        assert.throws(() => config({ config: {} }), /not configured/);
        const eas = JSON.parse(
          await readFile(
            new URL("../../" + app + "-app/eas.json", import.meta.url),
            "utf8",
          ),
        );
        assert.equal(eas.cli.appVersionSource,"remote");
      assert.equal(eas.build.staging.autoIncrement,true);
      assert.equal(eas.build.production.autoIncrement,true);
      assert.equal(eas.build.staging.channel, "staging");
        assert.equal(eas.build.staging.environment, "preview");
        assert.equal(eas.build.production.channel, "production");
        assert.equal(eas.build.production.environment, "production");
      } finally {
        process.chdir(old);
        if (env === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
        else process.env.EXPO_PUBLIC_APP_ENV = env;
        await rm(path, { recursive: true, force: true });
      }
    },
  );
  test(
    app +
      " OTA downloads compatible update without a reload, preserves running version on failure",
    async () => {
      const { downloadOnce } = await import(
        "../../" + app + "-app/integration/update-policy.ts"
      );
      let checks = 0,
        fetches = 0,
        reloads = 0;
      const adapter = {
        checkForUpdateAsync: async () => {
          checks++;
          return { isAvailable: true };
        },
        fetchUpdateAsync: async () => {
          fetches++;
          return {};
        },
        reloadAsync: async () => {
          reloads++;
        },
      };
      await downloadOnce(adapter);
      assert.equal(checks, 1);
      assert.equal(fetches, 1);
      assert.equal(reloads, 0);
      await downloadOnce({
        ...adapter,
        checkForUpdateAsync: async () => ({ isAvailable: false }),
      });
      assert.equal(fetches, 1);
      await assert.doesNotReject(
        downloadOnce({
          ...adapter,
          checkForUpdateAsync: async () => {
            throw Error("offline");
          },
        }),
      );
      await assert.doesNotReject(
        downloadOnce({
          ...adapter,
          fetchUpdateAsync: async () => {
            throw Error("incompatible update rejected by native library");
          },
        }),
      );
      assert.equal(reloads, 0);
      const source = await readFile(
        new URL(
          "../../" + app + "-app/integration/updates.ts",
          import.meta.url,
        ),
        "utf8",
      );
      assert(source.includes("requested"));
      assert(!source.includes("reloadAsync"));
    },
  );
}
