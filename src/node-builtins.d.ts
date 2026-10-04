/**
 * Minimal ambient declarations for the Node built-ins the tests use.
 *
 * The project deliberately has no `@types/node` — the runtime is a browser
 * build and the dependency list is kept to four packages (see `AGENTS.md`).
 * The test runner is Node though, so `node:fs` is genuinely available at
 * runtime; only the types are missing.
 *
 * If `@types/node` is ever added, delete this file: the two will conflict.
 * Test files should be the only things that ever need it.
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Buffer;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
declare module 'node:path' {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
}

interface Buffer {
  readonly length: number;
  readUInt32LE(offset: number): number;
  toString(encoding: string, start?: number, end?: number): string;
  slice(start?: number, end?: number): Buffer;
  [index: number]: number;
}
