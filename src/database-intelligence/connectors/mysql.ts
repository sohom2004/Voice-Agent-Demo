import mysql from 'mysql2/promise';
import {
  DatabaseConnector,
  ConnectionConfig,
  DiscoveredSchema,
  TableMetadata,
  ColumnMetadata,
  RelationshipMetadata
} from './base';

export class MysqlConnector extends DatabaseConnector {
  private client: mysql.Connection | null = null;

  constructor(config: ConnectionConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this.client) return;

    this.client = await mysql.createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      connectTimeout: 5000 // 5 seconds connection timeout
    });
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

    const schemaName = this.config.database; // MySQL schema is the database name

    // 1. Get approximate row counts
    const [rowCountsRows] = await this.client.execute(
      `SELECT table_name, COALESCE(table_rows, 0) AS row_count
       FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      [schemaName]
    );
    
    const rowCountsMap = new Map<string, number>();
    (rowCountsRows as any[]).forEach(row => {
      rowCountsMap.set(row.table_name, row.row_count);
    });

    // 2. Get primary keys
    const [pkRows] = await this.client.execute(
      `SELECT table_name, column_name
       FROM information_schema.key_column_usage
       WHERE table_schema = ? AND constraint_name = 'PRIMARY'`,
      [schemaName]
    );
    
    const pkSet = new Set<string>(); // TableName:ColumnName
    (pkRows as any[]).forEach(row => {
      pkSet.add(`${row.table_name}:${row.column_name}`);
    });

    // 3. Get foreign keys
    const [fkRows] = await this.client.execute(
      `SELECT
          table_name AS source_table,
          column_name AS source_column,
          referenced_table_name AS target_table,
          referenced_column_name AS target_column
       FROM
          information_schema.key_column_usage
       WHERE table_schema = ? AND referenced_table_name IS NOT NULL`,
      [schemaName]
    );

    const fkMap = new Map<string, { targetTable: string; targetColumn: string }>(); // TableName:ColumnName
    const relationships: RelationshipMetadata[] = [];

    (fkRows as any[]).forEach(row => {
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
        relationshipType: 'many_to_one'
      });
    });

    // 4. Get columns and tables metadata
    const [colRows] = await this.client.execute(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = ?
       ORDER BY table_name, ordinal_position`,
      [schemaName]
    );

    const tablesMap = new Map<string, TableMetadata>();

    (colRows as any[]).forEach(row => {
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
    const sanitizedTable = tableName.replace(/[^\w-]/g, '');
    const schemaName = this.config.database;
    
    // We execute the query with a strict limit
    return this.executeRead(`SELECT * FROM \`${schemaName}\`.\`${sanitizedTable}\` LIMIT ?`, [limit]);
  }

  async executeRead(sql: string, params: any[], timeoutMs = 3000): Promise<any[]> {
    if (!this.client) {
      throw new Error('Database not connected.');
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Query execution timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const queryPromise = this.client.execute(sql, params).then(([rows]) => rows as any[]);

    return Promise.race([queryPromise, timeoutPromise]);
  }

  async executeWrite(sql: string, params: any[], timeoutMs = 5000): Promise<{ affectedRows: number }> {
    if (!this.client) {
      throw new Error('Database not connected.');
    }

    await this.client.query('START TRANSACTION');
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Transaction timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const writePromise = this.client.execute(sql, params);
      const [res] = await Promise.race([writePromise, timeoutPromise]);
      
      await this.client.query('COMMIT');
      return { affectedRows: (res as any).affectedRows || 0 };
    } catch (err) {
      await this.client.query('ROLLBACK');
      throw err;
    }
  }
}
