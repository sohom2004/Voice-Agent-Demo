import type { SchemaSnapshot, TableInfo, ColumnInfo, ToolDefinition, ToolManifest } from '../types';

/**
 * Deterministic, rule-based compilation from schema -> tools.
 *
 * This intentionally does NOT use an LLM to decide what tools exist — the set of
 * operations (get/list/count/create/update/delete) and their parameters are derived
 * directly from the schema shape. That keeps the safety-critical mapping (which
 * columns are writable, which is the primary key) fully deterministic and testable.
 *
 * An LLM pass can optionally be layered on top later purely to improve `description`
 * text for better tool-selection by the calling agent — never to change params or
 * which table/operation a tool touches.
 */
export class ManifestCompiler {
  private nextVersion: number;

  constructor(previousVersion = 0) {
    this.nextVersion = previousVersion + 1;
  }

  compile(snapshot: SchemaSnapshot): ToolManifest {
    const tools: ToolDefinition[] = [];
    for (const table of snapshot.tables) {
      tools.push(...this.toolsForTable(table));
    }

    return {
      tenantId: snapshot.tenantId,
      version: this.nextVersion,
      schemaHash: snapshot.hash,
      generatedAt: new Date().toISOString(),
      tools,
    };
  }

  private toolsForTable(table: TableInfo): ToolDefinition[] {
    const pk = table.columns.find((c) => c.isPrimaryKey);
    const writableColumns = table.columns.filter((c) => !c.isPrimaryKey);
    const filterableColumns = table.columns.filter((c) => isSimpleFilterableType(c.dataType));
    const tools: ToolDefinition[] = [];

    if (pk) {
      tools.push({
        name: `get_${table.name}_by_id`,
        description: `Fetch a single row from ${table.name} by its ${pk.name}.`,
        operation: 'get_by_id',
        table: table.name,
        isWrite: false,
        params: [{ name: pk.name, columnType: pk.dataType, required: true, isFilter: true }],
      });

      tools.push({
        name: `update_${table.name}_by_id`,
        description: `Update one or more fields on a ${table.name} row identified by ${pk.name}.`,
        operation: 'update_by_id',
        table: table.name,
        isWrite: true,
        params: [
          { name: pk.name, columnType: pk.dataType, required: true, isFilter: true },
          ...writableColumns.map((c) => paramFor(c, false)),
        ],
      });

      tools.push({
        name: `delete_${table.name}_by_id`,
        description: `Delete a single row from ${table.name} identified by ${pk.name}.`,
        operation: 'delete_by_id',
        table: table.name,
        isWrite: true,
        params: [{ name: pk.name, columnType: pk.dataType, required: true, isFilter: true }],
      });
    }

    tools.push({
      name: `list_${table.name}`,
      description: `List rows from ${table.name}, optionally filtered by ${
        filterableColumns.map((c) => c.name).join(', ') || 'no simple columns'
      }.`,
      operation: 'list',
      table: table.name,
      isWrite: false,
      params: filterableColumns.map((c) => ({ ...paramFor(c, false), isFilter: true })),
    });

    tools.push({
      name: `count_${table.name}`,
      description: `Count rows in ${table.name}, optionally filtered.`,
      operation: 'count',
      table: table.name,
      isWrite: false,
      params: filterableColumns.map((c) => ({ ...paramFor(c, false), isFilter: true })),
    });

    const requiredCreateColumns = writableColumns.filter((c) => !c.isNullable);
    tools.push({
      name: `create_${table.name}`,
      description: `Insert a new row into ${table.name}.`,
      operation: 'create',
      table: table.name,
      isWrite: true,
      params: writableColumns.map((c) => paramFor(c, requiredCreateColumns.includes(c))),
    });

    return tools;
  }
}

function paramFor(c: ColumnInfo, required: boolean) {
  return { name: c.name, columnType: c.dataType, required };
}

function isSimpleFilterableType(dataType: string): boolean {
  const t = dataType.toLowerCase();
  return (
    t.includes('int') ||
    t.includes('char') ||
    t.includes('text') ||
    t.includes('bool') ||
    t.includes('date') ||
    t.includes('time') ||
    t.includes('uuid') ||
    t.includes('numeric') ||
    t.includes('decimal')
  );
}
