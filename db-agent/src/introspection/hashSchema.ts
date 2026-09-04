import { createHash } from 'crypto';
import type { TableInfo } from '../types';

/**
 * Deterministic content hash of a schema shape. Used to decide whether a tenant's
 * manifest needs recompiling — if the hash hasn't changed, skip the LLM-assisted
 * compilation step entirely and reuse the cached manifest.
 */
export function hashSchema(tables: TableInfo[]): string {
  const normalized = [...tables]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      name: t.name,
      columns: [...t.columns]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          name: c.name,
          type: c.dataType,
          nullable: c.isNullable,
          pk: c.isPrimaryKey,
          fk: c.referencesTable ?? null,
        })),
    }));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
