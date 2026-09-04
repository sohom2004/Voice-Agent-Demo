import { ManifestCompiler } from '../src/manifest/ManifestCompiler';
import { hashSchema } from '../src/introspection/hashSchema';
import { manifestToToolSchemas } from '../src/manifest/toToolSchema';
import type { SchemaSnapshot, TableInfo } from '../src/types';

const orders: TableInfo = {
  name: 'orders',
  columns: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, isForeignKey: false },
    { name: 'customer_id', dataType: 'integer', isNullable: false, isPrimaryKey: false, isForeignKey: true, referencesTable: 'customers', referencesColumn: 'id' },
    { name: 'status', dataType: 'character varying', isNullable: false, isPrimaryKey: false, isForeignKey: false },
    { name: 'total_cents', dataType: 'integer', isNullable: false, isPrimaryKey: false, isForeignKey: false },
    { name: 'notes', dataType: 'text', isNullable: true, isPrimaryKey: false, isForeignKey: false },
    { name: 'created_at', dataType: 'timestamp without time zone', isNullable: false, isPrimaryKey: false, isForeignKey: false },
  ],
};

const customers: TableInfo = {
  name: 'customers',
  columns: [
    { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, isForeignKey: false },
    { name: 'email', dataType: 'character varying', isNullable: false, isPrimaryKey: false, isForeignKey: false },
    { name: 'phone', dataType: 'character varying', isNullable: true, isPrimaryKey: false, isForeignKey: false },
  ],
};

const tables = [orders, customers];
const snapshot: SchemaSnapshot = {
  tenantId: 'test-tenant',
  dialect: 'postgres',
  tables,
  fetchedAt: new Date().toISOString(),
  hash: hashSchema(tables),
};

const compiler = new ManifestCompiler();
const manifest = compiler.compile(snapshot);

console.log(`\nCompiled ${manifest.tools.length} tools from ${tables.length} tables:\n`);
for (const t of manifest.tools) {
  const req = t.params.filter((p) => p.required).map((p) => p.name);
  console.log(`  ${t.isWrite ? '[write]' : '[read] '} ${t.name}(${t.params.map((p) => p.name).join(', ')})  required=[${req.join(', ')}]`);
}

console.log('\nSample LLM tool schema (get_orders_by_id):');
const schemas = manifestToToolSchemas(manifest);
console.log(JSON.stringify(schemas.find((s) => s.name === 'get_orders_by_id'), null, 2));

// Sanity assertions
const names = manifest.tools.map((t) => t.name);
const expected = [
  'get_orders_by_id', 'update_orders_by_id', 'delete_orders_by_id', 'list_orders', 'count_orders', 'create_orders',
  'get_customers_by_id', 'update_customers_by_id', 'delete_customers_by_id', 'list_customers', 'count_customers', 'create_customers',
];
const missing = expected.filter((e) => !names.includes(e));
if (missing.length) {
  console.error('\nFAIL — missing expected tools:', missing);
  process.exit(1);
}

// Recompiling the same snapshot with the same schema hash should be idempotent in shape.
const secondCompile = new ManifestCompiler(manifest.version).compile(snapshot);
if (secondCompile.schemaHash !== manifest.schemaHash) {
  console.error('\nFAIL — schema hash not stable across recompiles');
  process.exit(1);
}

console.log('\nPASS — all expected tools generated, hash stable.\n');
