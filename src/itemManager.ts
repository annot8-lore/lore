import type { LoreSnapshot, LoreItem, SavePayload } from './types';
import { nowISO } from './fsUtils';

/**
 * Upsert a Lore item into snapshot.items.
 - If payload.id exists and matches an item, update it.
 - Otherwise, create a fresh item with a new id (or the supplied id when provided and not found).
 
 Returns the id of the modified/created item.
 */
export function upsertLoreItem(snapshot: LoreSnapshot, payload: SavePayload, relFile: string, startLine: number, endLine: number): string {
  snapshot.items = snapshot.items || [];

  const makeNewItem = (id?: string): LoreItem => ({
    id: id ?? `lore-${Date.now()}`,
    state: 'active',
    file: payload.file || relFile,
    location: { startLine: payload.startLine || startLine, endLine: payload.endLine || endLine },
    summary: payload.summary || '',
    bodyMarkdown: payload.body || '',
    tags: payload.tags || [],
    links: payload.links || [],
    author: payload.author || '',
    createdAt: nowISO(),
    updatedAt: nowISO(),
    contentType: 'markdown',
    isTrusted: false
  });

  if (payload.id) {
    const idx = snapshot.items.findIndex(i => i.id === payload.id);
    if (idx >= 0) {
      const existing = snapshot.items[idx];
      const updated: LoreItem = {
        ...existing,
        state: existing.state || 'active',
        file: payload.file || relFile || existing.file,
        location: {
          startLine: payload.startLine || startLine || existing.location.startLine,
          endLine: payload.endLine || endLine || existing.location.endLine,
          anchorText: existing.location?.anchorText,
          contextPreview: existing.location?.contextPreview,
          lineHash: existing.location?.lineHash
        },
        summary: payload.summary ?? existing.summary,
        bodyMarkdown: payload.body ?? existing.bodyMarkdown,
        tags: payload.tags ?? existing.tags ?? [],
        links: payload.links ?? existing.links ?? [],
        author: payload.author ?? existing.author ?? '',
        createdAt: existing.createdAt,
        updatedAt: nowISO(),
        contentType: existing.contentType ?? 'markdown',
        isTrusted: existing.isTrusted ?? false
      };

      snapshot.items[idx] = updated;
      return updated.id;
    }

    // id provided but not found; create an item using the supplied id
    const created = makeNewItem(payload.id);
    snapshot.items.push(created);
    return created.id;
  }

  const created = makeNewItem();
  snapshot.items.push(created);
  return created.id;
}
