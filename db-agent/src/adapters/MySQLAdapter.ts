import knexFactory, { Knex } from 'knex';
import type { ConnectionConfig, ColumnInfo, TableInfo } from '../types';
import type { DBAdapter } from './DBAdapter';

interface RawRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_key: string;
  referenced_table_name: string | null;
  referenced_column_name: string | null;
}

export class MySQLAdapter implements DBAdapter {
  readonly dialect = 'mysql' as const;
  private knex: Knex;
  private schema: string;

  constructor(config: ConnectionConfig) {
    this.schema = config.schema ?? config.database;
    this.knex = knexFactory({
      client: 'mysql2',
      connection: {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl ? {} : undefined,
      },
      pool: { min: 0, max: 5 },
      acquireConnectionTimeout: 5000,
    });
  }

  getKnex(): Knex {
    return this.knex;
  }

  async introspect(): Promise<TableInfo[]> {
    // MySQL's key_column_usage carries referenced_table_name / referenced_column_name
    // directly for FKs, so no extra join is needed the way Postgres requires one.
    const [rows] = (await this.knex.raw(
      `
      select
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_key,
        kcu.referenced_table_name,
        kcu.referenced_column_name
      from information_schema.columns c
      left join information_schema.key_column_usage kcu
        on kcu.table_schema = c.table_schema
       and kcu.table_name = c.table_name
       and kcu.column_name = c.column_name
       and kcu.referenced_table_name is not null
      where c.table_schema = ?
      order by c.table_name, c.ordinal_position
      `,
      [this.schema]
    )) as unknown as [RawRow[]];

    return groupRowsIntoTables(rows);
  }

  async destroy(): Promise<void> {
    await this.knex.destroy();
  }
}

function groupRowsIntoTables(rows: RawRow[]): TableInfo[] {
  const byTable = new Map<string, ColumnInfo[]>();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name)!.push({
      name: r.column_name,
      dataType: r.data_type,
      isNullable: r.is_nullable === 'YES',
      isPrimaryKey: r.column_key === 'PRI',
      isForeignKey: r.referenced_table_name !== null,
      referencesTable: r.referenced_table_name ?? undefined,
      referencesColumn: r.referenced_column_name ?? undefined,
    });
  }
  return Array.from(byTable.entries()).map(([name, columns]) => ({ name, columns }));
}
