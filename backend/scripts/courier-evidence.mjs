import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("../..", import.meta.url));
export const baseline = "abb8748";
export async function courierFingerprint() {
  const scope = [
    "courier-app/src",
    "courier-app/app.config.ts",
    "courier-app/package.json",
    "courier-app/package-lock.json",
    "courier-app/assets/task-tone.wav",
  ];
  const paths = (command) =>
    execFileSync("git", command, { cwd: root, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  const files = new Set([
    ...paths(["ls-tree", "-r", "--name-only", baseline, "--", ...scope]),
    ...paths(["ls-files", "-co", "--exclude-standard", "--", ...scope]),
  ]);
  const hash = createHash("sha256");
  for (const path of [...files].sort()) {
    try {
      hash.update(path).update(await readFile(`${root}/${path}`));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return hash.digest("hex");
}
