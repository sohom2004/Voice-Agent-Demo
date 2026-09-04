import type { Knex } from 'knex';
import type { ToolManifest, ExecutionOptions, ExecutionResult } from '../types';
import { Guardrails, GuardrailViolation } from '../guardrails/Guardrails';

export class FastPathExecutor {
  constructor(
    private knex: Knex,
    private manifest: ToolManifest,
    private guardrails: Guardrails = new Guardrails()
  ) {}

  updateManifest(manifest: ToolManifest): void {
    this.manifest = manifest;
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const tool = this.manifest.tools.find((t) => t.name === toolName);
    if (!tool) {
      // Not in the manifest — caller should route this to the slow (dynamic NL2SQL) path.
      return { status: 'not_found', error: `No tool named "${toolName}" in manifest v${this.manifest.version}` };
    }

    try {
      this.guardrails.validateParams(tool, params);
    } catch (err) {
      if (err instanceof GuardrailViolation) {
        return { status: 'error', error: err.message, toolUsed: toolName };
      }
      throw err;
    }

    if (this.guardrails.needsConfirmation(tool, options)) {
      return {
        status: 'confirmation_required',
        toolUsed: toolName,
        pendingChange: describeWrite(tool.operation, tool.table, params),
      };
    }

    const timeoutMs = this.guardrails.statementTimeoutMs;

    try {
      switch (tool.operation) {
        case 'get_by_id': {
          const [pkParam] = tool.params;
          const row = await this.knex(tool.table).where(pkParam.name, params[pkParam.name] as Knex.Value).first().timeout(timeoutMs);
          return { status: 'ok', data: row ?? null, rowCount: row ? 1 : 0, toolUsed: toolName };
        }

        case 'list': {
          const cap = this.guardrails.resolveRowCap(options);
          let q = this.knex(tool.table).limit(cap).timeout(timeoutMs);
          for (const p of tool.params) {
            if (params[p.name] !== undefined) q = q.where(p.name, params[p.name] as Knex.Value);
          }
          const rows = await q;
          return { status: 'ok', data: rows, rowCount: rows.length, toolUsed: toolName };
        }

        case 'count': {
          let q = this.knex(tool.table).timeout(timeoutMs);
          for (const p of tool.params) {
            if (params[p.name] !== undefined) q = q.where(p.name, params[p.name] as Knex.Value);
          }
          const [{ count }] = await q.count({ count: '*' });
          return { status: 'ok', data: { count: Number(count) }, toolUsed: toolName };
        }

        case 'create': {
          const [inserted] = await this.knex(tool.table).insert(params).returning('*').timeout(timeoutMs);
          return { status: 'ok', data: inserted ?? params, rowCount: 1, toolUsed: toolName };
        }

        case 'update_by_id': {
          const [pkParam, ...valueParams] = tool.params;
          const setValues: Record<string, unknown> = {};
          for (const p of valueParams) {
            if (params[p.name] !== undefined) setValues[p.name] = params[p.name];
          }
          if (Object.keys(setValues).length === 0) {
            return { status: 'error', error: 'No fields to update were provided', toolUsed: toolName };
          }
          const updated = await this.knex(tool.table)
            .where(pkParam.name, params[pkParam.name] as Knex.Value)
            .update(setValues)
            .returning('*')
            .timeout(timeoutMs);
          return { status: 'ok', data: updated[0] ?? null, rowCount: updated.length, toolUsed: toolName };
        }

        case 'delete_by_id': {
          const [pkParam] = tool.params;
          const deletedCount = await this.knex(tool.table)
            .where(pkParam.name, params[pkParam.name] as Knex.Value)
            .del()
            .timeout(timeoutMs);
          return { status: 'ok', rowCount: deletedCount, toolUsed: toolName };
        }

        default: {
          const exhaustiveCheck: never = tool.operation;
          return { status: 'error', error: `Unhandled operation: ${exhaustiveCheck}` };
        }
      }
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err), toolUsed: toolName };
    }
  }
}

function describeWrite(operation: string, table: string, params: Record<string, unknown>): string {
  return `${operation} on "${table}" with ${JSON.stringify(params)}`;
}
