import { DatabaseAgent } from '../src';

async function main() {
  const agent = new DatabaseAgent({
    tenantId: 'acme-corp',
    dialect: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'acme',
  });

  // Run once at onboarding, and again whenever a schema-change webhook fires.
  const manifest = await agent.syncManifest();
  console.log(`Compiled ${manifest.tools.length} tools for tenant "${manifest.tenantId}" (v${manifest.version})`);

  // Hand this straight to your LLM's function-calling config.
  const toolSchemas = agent.getToolSchemas();
  console.log(JSON.stringify(toolSchemas[0], null, 2));

  // Fast-path read — no LLM call needed beyond the orchestrator picking this tool.
  const read = await agent.callTool('get_orders_by_id', { id: 123 });
  console.log('read result:', read);

  // Fast-path write — first call previews, second call (confirmed) executes.
  const preview = await agent.callTool('update_orders_by_id', { id: 123, status: 'shipped' });
  console.log('preview:', preview); // status: 'confirmation_required'

  const applied = await agent.callTool(
    'update_orders_by_id',
    { id: 123, status: 'shipped' },
    { confirmed: true }
  );
  console.log('applied:', applied);

  await agent.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
