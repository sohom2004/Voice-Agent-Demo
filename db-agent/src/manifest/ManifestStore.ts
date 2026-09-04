import type { ToolManifest } from '../types';

export interface ManifestStore {
  get(tenantId: string): Promise<ToolManifest | null>;
  save(manifest: ToolManifest): Promise<void>;
}

/**
 * Default in-memory store — fine for a single process / dev use. Swap for a
 * Postgres/Redis-backed implementation of the same interface in production so
 * manifests survive restarts and are shared across instances.
 */
export class InMemoryManifestStore implements ManifestStore {
  private manifests = new Map<string, ToolManifest>();

  async get(tenantId: string): Promise<ToolManifest | null> {
    return this.manifests.get(tenantId) ?? null;
  }

  async save(manifest: ToolManifest): Promise<void> {
    this.manifests.set(manifest.tenantId, manifest);
  }
}
