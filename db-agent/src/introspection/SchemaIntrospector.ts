import type { DBAdapter } from '../adapters/DBAdapter';
import type { SchemaSnapshot } from '../types';
import { hashSchema } from './hashSchema';

export class SchemaIntrospector {
  constructor(private adapter: DBAdapter, private tenantId: string) {}

  async snapshot(): Promise<SchemaSnapshot> {
    const tables = await this.adapter.introspect();
    return {
      tenantId: this.tenantId,
      dialect: this.adapter.dialect,
      tables,
      fetchedAt: new Date().toISOString(),
      hash: hashSchema(tables),
    };
  }
}
