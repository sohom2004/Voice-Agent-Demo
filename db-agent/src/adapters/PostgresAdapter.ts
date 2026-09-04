import knexFactory, { Knex } from 'knex';
import type { ConnectionConfig, ColumnInfo, TableInfo } from '../types';
import type { DBAdapter } from './DBAdapter';

interface RawRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_primary_key: boolean;
  foreign_table_name: string | null;
  foreign_column_name: string | null;
}

export class PostgresAdapter implements DBAdapter {
  readonly dialect = 'postgres' as const;
  private knex: Knex;
  private schema: string;

  constructor(config: ConnectionConfig) {
    this.schema = config.schema ?? 'public';
    this.knex = knexFactory({
      client: 'pg',
      connection: {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      },
      pool: { min: 0, max: 5 },
      // Fail fast rather than hang the caller — latency budget matters here.
      acquireConnectionTimeout: 5000,
    });
  }

  getKnex(): Knex {
    return this.knex;
  }

  async introspect(): Promise<TableInfo[]> {
    const rows = await this.knex.raw<{ rows: RawRow[] }>(
      `
      select
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        (pk.column_name is not null) as is_primary_key,
        fk.foreign_table_name,
        fk.foreign_column_name
      from information_schema.columns c
      left join (
        select kcu.table_name, kcu.column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
        where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = ?
      ) pk on pk.table_name = c.table_name and pk.column_name = c.column_name
      left join (
        select
          kcu.table_name, kcu.column_name,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name
         and tc.table_schema = ccu.table_schema
        where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = ?
      ) fk on fk.table_name = c.table_name and fk.column_name = c.column_name
      where c.table_schema = ?
      order by c.table_name, c.ordinal_position
      `,
      [this.schema, this.schema, this.schema]
    );

    return groupRowsIntoTables(rows.rows);
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
      isPrimaryKey: r.is_primary_key,
      isForeignKey: r.foreign_table_name !== null,
      referencesTable: r.foreign_table_name ?? undefined,
      referencesColumn: r.foreign_column_name ?? undefined,
    });
  }
  return Array.from(byTable.entries()).map(([name, columns]) => ({ name, columns }));
}
