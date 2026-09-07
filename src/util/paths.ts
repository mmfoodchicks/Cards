/**
 * Locating project files at runtime.
 *
 * Walks up to the directory holding package.json rather than guessing a
 * relative depth, so the same code works under tsx (src/) and compiled (dist/).
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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
  const first = segments[0];
  if (first && isAbsolute(first)) return resolve(...segments);
  return resolve(projectRoot(), ...segments);
}
