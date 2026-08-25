/**
 * Locating project files at runtime.
 *
 * The catalog lives in `catalog/` at the project root rather than inside `src/`
 * so that it survives compilation unchanged and users can edit MSRP figures in
 * a plain JSON file without a rebuild. Both `src/util/` (tsx) and `dist/util/`
 * (compiled) need to find it, so we walk up to the directory holding
 * package.json instead of guessing a relative depth.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedRoot: string | null = null;

export function projectRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

export function fromRoot(...segments: string[]): string {
  return resolve(projectRoot(), ...segments);
}
