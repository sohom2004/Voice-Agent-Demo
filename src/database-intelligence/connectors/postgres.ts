import pg from 'pg';
import {
  DatabaseConnector,
  ConnectionConfig,
  DiscoveredSchema,
  TableMetadata,
  ColumnMetadata,
  RelationshipMetadata
} from './base';

export class PostgresConnector extends DatabaseConnector {
  private client: pg.Client | null = null;

  constructor(config: ConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this.client) return;

    this.client = new pg.Client({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000 // 5 seconds connection timeout
    });

    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }

  async inspectSchema(): Promise<DiscoveredSchema> {
    if (!this.client) {
      throw new Error('Database not connected. Call connect() first.');
    }

    const schemaName = this.config.schema || 'public';

    // 1. Get approximate row counts from pg_class
    const rowCountsRes = await this.client.query(`
      SELECT c.relname AS table_name, COALESCE(c.reltuples::integer, 0) AS row_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'r';
    `, [schemaName]);
    
    const rowCountsMap = new Map<string, number>();
    rowCountsRes.rows.forEach(row => {
      rowCountsMap.set(row.table_name, row.row_count);
    });

    // 2. Get primary keys
    const pkRes = await this.client.query(`
      SELECT kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1;
    `, [schemaName]);
    
    const pkSet = new Set<string>(); // TableName:ColumnName
    pkRes.rows.forEach(row => {
      pkSet.add(`${row.table_name}:${row.column_name}`);
    });

    // 3. Get foreign keys
    const fkRes = await this.client.query(`
      SELECT
          tc.table_name AS source_table,
          kcu.column_name AS source_column,
          ccu.table_name AS target_table,
          ccu.column_name AS target_column
      FROM
          information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1;
    `, [schemaName]);

    const fkMap = new Map<string, { targetTable: string; targetColumn: string }>(); // TableName:ColumnName
    const relationships: RelationshipMetadata[] = [];

    fkRes.rows.forEach(row => {
      const fkKey = `${row.source_table}:${row.source_column}`;
      fkMap.set(fkKey, {
        targetTable: row.target_table,
        targetColumn: row.target_column
      });

      relationships.push({
        sourceTable: row.source_table,
        sourceColumn: row.source_column,
        targetTable: row.target_table,
        targetColumn: row.target_column,
        relationshipType: 'many_to_one' // Default many-to-one mapping for FK constraints
      });
    });

    // 4. Get columns and tables metadata
    const colRes = await this.client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, ordinal_position;
    `, [schemaName]);

    const tablesMap = new Map<string, TableMetadata>();

    colRes.rows.forEach(row => {
      const tableName = row.table_name;
      const colName = row.column_name;
      const colKey = `${tableName}:${colName}`;

      const isPrimaryKey = pkSet.has(colKey);
      const isForeignKey = fkMap.has(colKey);
      const fkRefs = fkMap.get(colKey);

      const colMeta: ColumnMetadata = {
        name: colName,
        dataType: row.data_type,
        isNullable: row.is_nullable === 'YES',
        isPrimaryKey,
        isForeignKey,
        defaultValue: row.column_default || undefined,
        foreignKeyReferences: fkRefs
      };

      let tableMeta = tablesMap.get(tableName);
      if (!tableMeta) {
        tableMeta = {
          name: tableName,
          schemaName,
          columns: [],
          rowCount: rowCountsMap.get(tableName) || 0
        };
        tablesMap.set(tableName, tableMeta);
      }
      tableMeta.columns.push(colMeta);
    });

    return {
      tables: Array.from(tablesMap.values()),
      relationships
    };
  }

  async sampleTable(tableName: string, limit: number): Promise<any[]> {
    // Sanitize table name to prevent SQL injection (must match identified tables only)
    const sanitizedTable = tableName.replace(/[^\w-]/g, '');
    const schemaName = this.config.schema || 'public';
    
    // We execute the query with a strict limit
    return this.executeRead(`SELECT * FROM "${schemaName}"."${sanitizedTable}" LIMIT $1`, [limit]);
  }

  async executeRead(sql: string, params: any[], timeoutMs = 3000): Promise<any[]> {
    if (!this.client) {
      throw new Error('Database not connected.');
    }

    // Set query timeout dynamically using pg parameters
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Query execution timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const queryPromise = this.client.query(sql, params).then(res => res.rows);

    return Promise.race([queryPromise, timeoutPromise]);
  }

  async executeWrite(sql: string, params: any[], timeoutMs = 5000): Promise<{ affectedRows: number }> {
    if (!this.client) {
      throw new Error('Database not connected.');
    }

    // We execute the write command in a transaction to protect data integrity
    await this.client.query('BEGIN');
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Transaction timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const writePromise = this.client.query(sql, params);
      const res = await Promise.race([writePromise, timeoutPromise]);
      
      await this.client.query('COMMIT');
      return { affectedRows: res.rowCount || 0 };
    } catch (err) {
      await this.client.query('ROLLBACK');
      throw err;
    }
  }
}
