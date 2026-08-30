export interface ColumnMetadata {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  defaultValue?: string;
  foreignKeyReferences?: {
    targetTable: string;
    targetColumn: string;
  };
}

export interface TableMetadata {
  name: string;
  schemaName: string;
  columns: ColumnMetadata[];
  rowCount?: number;
}

export interface RelationshipMetadata {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: 'many_to_one' | 'one_to_many' | 'one_to_one';
}

export interface DiscoveredSchema {
  tables: TableMetadata[];
  relationships: RelationshipMetadata[];
}

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  schema?: string;
  ssl?: boolean;
}

export abstract class DatabaseConnector {
  protected config: ConnectionConfig;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  /**
   * Validates and establishes a connection to the target database.
   */
  abstract connect(): Promise<void>;

  /**
   * Safely closes the database connection.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Inspects the database catalogue to discover tables, columns, constraints, and relationships.
   */
  abstract inspectSchema(): Promise<DiscoveredSchema>;

  /**
   * Fetches a small representative sample of rows from a table.
   */
  abstract sampleTable(tableName: string, limit: number): Promise<any[]>;

  /**
   * Executes a parameterized read-only query with timeouts.
   */
  abstract executeRead(sql: string, params: any[], timeoutMs?: number): Promise<any[]>;

  /**
   * Executes a parameterized write query within a transaction.
   */
  abstract executeWrite(sql: string, params: any[], timeoutMs?: number): Promise<{ affectedRows: number }>;
}
