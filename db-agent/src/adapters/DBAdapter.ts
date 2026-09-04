import type { Knex } from 'knex';
import type { DBDialect, TableInfo } from '../types';

export interface DBAdapter {
  readonly dialect: DBDialect;
  /** Underlying Knex instance, shared by the introspector and the fast-path executor so pooling is consistent. */
  getKnex(): Knex;
  introspect(): Promise<TableInfo[]>;
  destroy(): Promise<void>;
}
