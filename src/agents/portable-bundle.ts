/**
 * Portable agent bundle on-disk representation.
 *
 * Two formats are supported, both single-file for ease of sharing:
 *
 *   1. `json`  — plain UTF-8 JSON. Diff-friendly, ideal for git, recommended
 *                default for templates checked into a repo.
 *   2. `tgz`   — gzipped JSON (the same bytes as `json` but `gzip`-encoded).
 *                Same name "tar" is loosely used in the issue but we deliberately
 *                avoid an actual `tar` dependency: a single-file bundle does
 *                not need archive concatenation, and `node:zlib` ships with
 *                Node 20+. The extension is still `.aistack-agent` regardless;
 *                callers should detect the magic byte (`0x1f 0x8b` for gzip).
 *
 * All filesystem I/O lives here so the pure `portable.ts` module stays unit
 * testable without touching disk.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  parse as parsePortable,
  serialize as serializePortable,
} from './portable.js';
import type { PortableAgentFile } from './portable-schema.js';

/** Recognised file formats. */
export type BundleFormat = 'json' | 'tgz';

/** Gzip magic bytes (RFC 1952 §2.3.1). */
const GZIP_MAGIC = Uint8Array.from([0x1f, 0x8b]);

function isGzipped(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1];
}

/**
 * Write a portable file to disk in the requested format. Returns the
 * absolute path written.
 */
export async function writeBundle(
  path: string,
  file: PortableAgentFile,
  format: BundleFormat = 'json'
): Promise<string> {
  const json = serializePortable(file);
  if (format === 'tgz') {
    const compressed = gzipSync(Buffer.from(json, 'utf8'));
    await writeFile(path, compressed);
  } else {
    await writeFile(path, json, 'utf8');
  }
  return path;
}

/**
 * Read and validate a bundle from disk. Auto-detects gzip vs plain JSON via
 * magic bytes — caller does not need to know which format was used.
 */
export async function readBundle(path: string): Promise<PortableAgentFile> {
  const buf = await readFile(path);
  const text = isGzipped(buf)
    ? gunzipSync(buf).toString('utf8')
    : buf.toString('utf8');
  return parsePortable(text);
}

/**
 * Pure in-memory variant of `readBundle` — useful for tests and for stdin
 * pipelines (e.g. `aistack agent import < file.aistack-agent`).
 */
export function parseBundleBuffer(buf: Buffer): PortableAgentFile {
  const text = isGzipped(buf)
    ? gunzipSync(buf).toString('utf8')
    : buf.toString('utf8');
  return parsePortable(text);
}

/** Pure in-memory variant of `writeBundle`. */
export function serializeBundleBuffer(
  file: PortableAgentFile,
  format: BundleFormat = 'json'
): Buffer {
  const json = serializePortable(file);
  if (format === 'tgz') {
    return gzipSync(Buffer.from(json, 'utf8'));
  }
  return Buffer.from(json, 'utf8');
}
