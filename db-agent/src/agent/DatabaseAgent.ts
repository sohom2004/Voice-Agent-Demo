import type { ConnectionConfig, ExecutionOptions, ExecutionResult, ToolManifest } from '../types';
import { createAdapter, type DBAdapter } from '../adapters';
import { SchemaIntrospector } from '../introspection/SchemaIntrospector';
import { ManifestCompiler } from '../manifest/ManifestCompiler';
import { ManifestStore, InMemoryManifestStore } from '../manifest/ManifestStore';
import { manifestToToolSchemas, type LLMToolSchema } from '../manifest/toToolSchema';
import { Guardrails, type GuardrailConfig } from '../guardrails/Guardrails';
import { FastPathExecutor } from '../executor/FastPathExecutor';

export interface DatabaseAgentOptions {
  manifestStore?: ManifestStore;
  guardrailConfig?: GuardrailConfig;
}

/**
 * Single entry point for one tenant's database connection.
 *
 *   const agent = new DatabaseAgent(connectionConfig);
 *   await agent.connect();          // opens pooled connection
 *   await agent.syncManifest();     // introspects + compiles (or reuses cache) — run at onboarding
 *                                    // and again on a schema-change webhook/schedule
 *   const tools = agent.getToolSchemas();   // hand these to the LLM's function-calling
 *   const result = await agent.callTool('get_orders_by_id', { id: 123 });
 */
export class DatabaseAgent {
  private adapter: DBAdapter;
  private manifestStore: ManifestStore;
  private guardrails: Guardrails;
  private manifest: ToolManifest | null = null;
  private executor: FastPathExecutor | null = null;

  constructor(private config: ConnectionConfig, options: DatabaseAgentOptions = {}) {
    this.adapter = createAdapter(config);
    this.manifestStore = options.manifestStore ?? new InMemoryManifestStore();
    this.guardrails = new Guardrails(options.guardrailConfig);
  }

  /**
   * Introspects the tenant's schema and compiles (or reuses) the tool manifest.
   * Cheap to call repeatedly — it's a no-op recompile if the schema hash hasn't changed.
   */
  async syncManifest(): Promise<ToolManifest> {
    const introspector = new SchemaIntrospector(this.adapter, this.config.tenantId);
    const snapshot = await introspector.snapshot();

    const existing = await this.manifestStore.get(this.config.tenantId);
    if (existing && existing.schemaHash === snapshot.hash) {
      this.manifest = existing;
    } else {
      const compiler = new ManifestCompiler(existing?.version ?? 0);
      this.manifest = compiler.compile(snapshot);
      await this.manifestStore.save(this.manifest);
    }

    this.executor = new FastPathExecutor(this.adapter.getKnex(), this.manifest, this.guardrails);
    return this.manifest;
  }

  async getSnapshot() {
    const introspector = new SchemaIntrospector(this.adapter, this.config.tenantId);
    return await introspector.snapshot();
  }

  getManifest(): ToolManifest {
    if (!this.manifest) throw new Error('Manifest not synced yet — call syncManifest() first');
    return this.manifest;
  }

  /** Tool definitions in Anthropic/OpenAI-compatible function-calling format. */
  getToolSchemas(): LLMToolSchema[] {
    return manifestToToolSchemas(this.getManifest());
  }

  async callTool(name: string, params: Record<string, unknown>, options?: ExecutionOptions): Promise<ExecutionResult> {
    if (!this.executor) throw new Error('Manifest not synced yet — call syncManifest() first');
    return this.executor.callTool(name, params, options);
  }

  async disconnect(): Promise<void> {
    await this.adapter.destroy();
  }
}
