import type { ConnectionConfig } from '../types';
import type { DBAdapter } from './DBAdapter';
import { PostgresAdapter } from './PostgresAdapter';
import { MySQLAdapter } from './MySQLAdapter';
import { SQLiteAdapter } from './SQLiteAdapter';

export function createAdapter(config: ConnectionConfig): DBAdapter {
  switch (config.dialect) {
    case 'postgres':
      return new PostgresAdapter(config);
    case 'mysql':
      return new MySQLAdapter(config);
    case 'sqlite':
      return new SQLiteAdapter(config);
    default: {
      const exhaustiveCheck: never = config.dialect;
      throw new Error(`Unsupported dialect: ${exhaustiveCheck}`);
    }
  }
}

export type { DBAdapter } from './DBAdapter';
