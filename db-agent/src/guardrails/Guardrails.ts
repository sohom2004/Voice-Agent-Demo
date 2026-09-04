import type { ToolDefinition, ExecutionOptions } from '../types';

export interface GuardrailConfig {
  /** Hard ceiling on rows returned by list/count-style operations, regardless of caller input. */
  maxRows: number;
  /** Statement timeout in ms enforced at the query level. */
  statementTimeoutMs: number;
  /** Write operations require an explicit confirmed:true unless the tool is explicitly whitelisted here. */
  autoConfirmWrites: boolean;
}

export const DEFAULT_GUARDRAILS: GuardrailConfig = {
  maxRows: 200,
  statementTimeoutMs: 5000,
  autoConfirmWrites: false,
};

export class GuardrailViolation extends Error {}

export class Guardrails {
  constructor(private config: GuardrailConfig = DEFAULT_GUARDRAILS) {}

  /** Validates that every required param is present and no unexpected params were passed. */
  validateParams(tool: ToolDefinition, params: Record<string, unknown>): void {
    for (const p of tool.params) {
      if (p.required && !(p.name in params)) {
        throw new GuardrailViolation(`Missing required param "${p.name}" for tool "${tool.name}"`);
      }
    }
    const allowed = new Set(tool.params.map((p) => p.name));
    for (const key of Object.keys(params)) {
      if (!allowed.has(key)) {
        throw new GuardrailViolation(`Unexpected param "${key}" for tool "${tool.name}" — not part of the compiled manifest`);
      }
    }
  }

  /** Writes require an explicit confirmation round-trip unless auto-confirm is globally enabled. */
  needsConfirmation(tool: ToolDefinition, options: ExecutionOptions): boolean {
    if (!tool.isWrite) return false;
    if (this.config.autoConfirmWrites) return false;
    return options.confirmed !== true;
  }

  resolveRowCap(options: ExecutionOptions): number {
    if (options.maxRows && options.maxRows > 0) {
      return Math.min(options.maxRows, this.config.maxRows);
    }
    return this.config.maxRows;
  }

  get statementTimeoutMs(): number {
    return this.config.statementTimeoutMs;
  }
}
