import { DatabaseAgent } from '../src';

async function main() {
  const agent = new DatabaseAgent({
    tenantId: 'acme-corp', dialect: 'postgres',
    host: 'localhost', port: 5432, user: 'postgres', password: 'testpass', database: 'acme_test',
  });
  await agent.syncManifest();

  console.log('read (id=1):', await agent.callTool('get_orders_by_id', { id: 1 }));
  console.log('list orders:', await agent.callTool('list_orders', {}));

  const preview = await agent.callTool('update_orders_by_id', { id: 1, status: 'shipped' });
  console.log('write preview:', preview);
  const applied = await agent.callTool('update_orders_by_id', { id: 1, status: 'shipped' }, { confirmed: true });
  console.log('write applied:', applied);

  console.log('read after write (id=1):', await agent.callTool('get_orders_by_id', { id: 1 }));

  // Guardrail: unexpected param should be rejected, not silently applied
  console.log('injection attempt:', await agent.callTool('update_orders_by_id', { id: 1, status: 'x', is_admin: true } as any, { confirmed: true }));

  // Tool outside the manifest -> not_found, this is the slow-path trigger point
  console.log('unknown tool:', await agent.callTool('drop_all_tables', {}));

  await agent.disconnect();
}
main();
