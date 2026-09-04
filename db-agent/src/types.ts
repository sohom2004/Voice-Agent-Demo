export type DBDialect = 'postgres' | 'mysql' | 'sqlite';

export interface ConnectionConfig {
  tenantId: string;
  dialect: DBDialect;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
  /** Schema to introspect. Defaults to 'public' for postgres, the database name for mysql. */
  schema?: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencesTable?: string;
  referencesColumn?: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

export interface SchemaSnapshot {
  tenantId: string;
  dialect: DBDialect;
  tables: TableInfo[];
  fetchedAt: string;
  /** Content hash of the schema shape — used to detect drift and decide whether to recompile the manifest. */
  hash: string;
}

export type ToolOperation =
  | 'get_by_id'
  | 'list'
  | 'count'
  | 'create'
  | 'update_by_id'
  | 'delete_by_id';

export interface ToolParamSpec {
  name: string;
  columnType: string;
  required: boolean;
  /** True if this param is used as a filter/where clause rather than a write value. */
  isFilter?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  operation: ToolOperation;
  table: string;
  isWrite: boolean;
  params: ToolParamSpec[];
}

export interface ToolManifest {
  tenantId: string;
  version: number;
  schemaHash: string;
  generatedAt: string;
  tools: ToolDefinition[];
}

export interface ExecutionOptions {
  /** Must be true for write tools to actually execute; otherwise a preview is returned. */
  confirmed?: boolean;
  /** Overrides the default row cap for list/count operations. */
  maxRows?: number;
}

export interface ExecutionResult {
  status: 'ok' | 'error' | 'confirmation_required' | 'not_found';
  data?: unknown;
  error?: string;
  rowCount?: number;
  toolUsed?: string;
  /** Human-readable description of the pending write, shown when status === 'confirmation_required'. */
  pendingChange?: string;
}
