import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../..', import.meta.url));
export const baseline = 'c52621f';
export async function adminFingerprint() {
  const scope = ['admin-app/src', 'admin-app/app.config.ts', 'admin-app/package.json', 'admin-app/package-lock.json'];
  const previous = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, '--', ...scope], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const current = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...scope], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const hash = createHash('sha256');
  for (const path of [...new Set([...previous, ...current])].sort()) {
    try { hash.update(path).update(await readFile(`${root}/${path}`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return hash.digest('hex');
}
