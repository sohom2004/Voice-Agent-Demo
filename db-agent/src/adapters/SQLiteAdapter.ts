import knexFactory, { Knex } from 'knex';
import type { ConnectionConfig, ColumnInfo, TableInfo } from '../types';
import type { DBAdapter } from './DBAdapter';

interface SQLitePragmaColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: any;
  pk: number;
}

interface SQLiteForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
}

export class SQLiteAdapter implements DBAdapter {
  readonly dialect = 'sqlite' as const;
  private knex: Knex;
  private dbPath: string;

  constructor(config: ConnectionConfig) {
    this.dbPath = config.database || config.host || 'demo_database.db';
    this.knex = knexFactory({
      client: 'sqlite3',
      connection: {
        filename: this.dbPath,
      },
      useNullAsDefault: true,
      pool: { min: 0, max: 5 },
      acquireConnectionTimeout: 5000,
    });
  }

  getKnex(): Knex {
    return this.knex;
  }

  async introspect(): Promise<TableInfo[]> {
    const tablesRaw = await this.knex.raw<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );
    const tables = Array.isArray(tablesRaw) ? tablesRaw : (tablesRaw as any).rows || [];

    const result: TableInfo[] = [];

    for (const t of tables) {
      const tableName = t.name;
      const columnsRaw = await this.knex.raw<SQLitePragmaColumn[]>(`PRAGMA table_info('${tableName}');`);
      const fkRaw = await this.knex.raw<SQLiteForeignKey[]>(`PRAGMA foreign_key_list('${tableName}');`);

      const fkMap = new Map<string, { table: string; to: string }>();
      for (const fk of fkRaw || []) {
        fkMap.set(fk.from, { table: fk.table, to: fk.to });
      }

      const columns: ColumnInfo[] = (columnsRaw || []).map((col) => {
        const fkInfo = fkMap.get(col.name);
        return {
          name: col.name,
          dataType: col.type || 'TEXT',
          isNullable: col.notnull === 0,
          isPrimaryKey: col.pk > 0,
          isForeignKey: !!fkInfo,
          referencesTable: fkInfo?.table,
          referencesColumn: fkInfo?.to,
        };
      });

      result.push({ name: tableName, columns });
    }

    return result;
  }

  async destroy(): Promise<void> {
    await this.knex.destroy();
  }
}
