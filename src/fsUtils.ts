import * as path from 'path';
import { promises as fsp } from 'fs';
import { LoreSnapshot } from './types';

const LORE_FILE = '.lore.json';

// Cache ensureLoreFile results per workspace root. This avoids duplicate
// filesystem checks when ensureLoreFile is called multiple times for the same root (e.g. activation + later command invocation).

// NOTE: This project currently supports single-window usage only. The
// in-memory `ensureCache` is per extension-host process and will not be
// shared across multiple VS Code windows. If you open multiple VS Code
// windows, each runs a separate extension host with its own cache. If/when
// multi-window support is added we'll persist a validated path mapping to
// `context.globalState` (or another persistent backing store) and add
// appropriate validation and eviction logic.

const ensureCache = new Map<string, Promise<string>>();

/**
Writes a JSON file using a safe write pattern: write tmp, fsync, rename, fsync parent. 
 */
export async function safeWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `${path.basename(filePath)}.tmp.${Date.now()}`);
  const text = JSON.stringify(data, null, 2);

  await fsp.writeFile(tmp, text, { encoding: 'utf8' });

  const fd = await fsp.open(tmp, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }

  await fsp.rename(tmp, filePath);

  try {
    const dirFd = await fsp.open(dir, 'r');
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch (e) {
    // Best-effort; ignore failures to fsync parent.
  }
}

// Read a JSON file and parse it. Throws when file is invalid JSON.
export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export function nowISO() {
  return new Date().toISOString();
}

// Ensure .lore.json exists at the workspace root and return its path.
export function ensureLoreFile(root: string): Promise<string> {
  // Return a cached promise if present to deduplicate concurrent calls.
  const cached = ensureCache.get(root);
  if (cached) return cached;

  const promise = (async (): Promise<string> => {
    const filePath = path.join(root, LORE_FILE);
    try {
      await fsp.access(filePath);
      return filePath;
    } catch {
      const initial: LoreSnapshot = {
        schemaVersion: 1,
        fileMetadata: {
          workspace: path.basename(root),
          createdAt: nowISO(),
          lastUpdatedAt: nowISO(),
          lastUpdatedBy: ''
        },
        indexes: { tags: {}, filesWithComments: 0 },
        items: []
      };

      await safeWriteJson(filePath, initial);
      return filePath;
    }
  })();

  // On failure, remove the cache entry so future callers can retry.
  ensureCache.set(root, promise.catch((err) => { ensureCache.delete(root); throw err; }));
  return ensureCache.get(root)!;
}
