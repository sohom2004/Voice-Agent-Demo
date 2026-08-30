import { pool } from '../../storage/dbSetup';
import { setupDbIntelDatabase } from '../storage/dbIntelSetup';
import { IntelRepository } from '../storage/intelRepository';
import { SchemaInspector, getConnector } from '../discovery/schema_inspector';
import { DataSampler } from '../discovery/data_sampler';
import { QueryValidator } from '../security/query_validator';
import { QueryCompiler } from '../execution/query_compiler';
import { ReadExecutor } from '../execution/read_executor';
import { encryptCredentials } from '../security/credentials';
import { sessionMemory } from '../memory/session_memory';

async function runTests() {
  console.log('\n======================================================');
  console.log('STARTING DATABASE INTELLIGENCE INTEGRATION TEST SUITE');
  console.log('======================================================\n');

  let testConnectionId = 'conn_test_suite_12345';
  const intelRepo = new IntelRepository();
  const inspector = new SchemaInspector();
  const sampler = new DataSampler();
  const validator = new QueryValidator();
  const compiler = new QueryCompiler();
  const readExecutor = new ReadExecutor();

  try {
    // 0. Ensure Database Tables are initialized
    await setupDbIntelDatabase();

    // Clean up any stale test connections first
    await intelRepo.deleteConnection(testConnectionId);

    // 1. Create a DB Connection Configuration pointing to our own local Postgres
    const host = process.env.PGHOST || 'localhost';
    const port = parseInt(process.env.PGPORT || '5432');
    const user = process.env.PGUSER || 'postgres';
    const password = process.env.PGPASSWORD || '';
    const database = process.env.PGDATABASE || 'postgres';

    const connConfig = { host, port, user, password, database, schema: 'public' };
    const encryptedConfig = encryptCredentials(JSON.stringify(connConfig));

    console.log('[Test] Creating database connection record...');
    const connRecord = await intelRepo.createConnection({
      id: testConnectionId,
      workspaceId: 'test_workspace_alpha',
      name: 'Local Test DB',
      provider: 'postgres',
      connectionConfig: encryptedConfig,
      status: 'disconnected'
    });
    console.log('✓ Connection record created successfully.');

    // 2. Test Schema Inspection
    console.log('[Test] Inspecting schema of local database...');
    const schema = await inspector.inspect(connRecord.provider, connRecord.connectionConfig);
    console.log(`✓ Schema inspected. Discovered ${schema.tables.length} tables.`);

    // Assert that standard tables like db_connections exist
    const hasConnectionsTable = schema.tables.some(t => t.name === 'db_connections');
    const hasTablesTable = schema.tables.some(t => t.name === 'db_tables');
    if (!hasConnectionsTable || !hasTablesTable) {
      throw new Error('Assertion failed: Discovered schema does not contain metadata tables db_connections or db_tables.');
    }
    console.log('✓ Verified discovery of tables "db_connections" and "db_tables".');

    // 3. Test Data Sampling & Sensitive Data Masking
    console.log('[Test] Testing sensitive sampling and masking on "db_connections" table...');
    const connector = getConnector(connRecord.provider, connRecord.connectionConfig);
    await connector.connect();
    
    // Sample rows from db_connections
    const sampledRows = await sampler.sampleAndMask(connector, 'db_connections', 5);
    await connector.disconnect();

    console.log(`✓ Fetched ${sampledRows.length} sample rows.`);
    if (sampledRows.length > 0) {
      const firstRow = sampledRows[0];
      // Assert that sensitive credentials column connection_config is masked
      if (firstRow.connection_config && !firstRow.connection_config.startsWith('[MASKED_')) {
        throw new Error(`Assertion failed: sensitive column "connection_config" was not masked! Value was: ${firstRow.connection_config}`);
      }
      console.log('✓ Verified sensitive column "connection_config" is masked successfully.');
    } else {
      console.log(' (Table was empty, masking assertion skipped but sampler ran cleanly.)');
    }

    // 4. Test Tenant / Workspace Isolation
    console.log('[Test] Testing tenant/workspace isolation...');
    const validPlan = {
      operation: 'SELECT' as const,
      tables: ['db_tables'],
      fields: ['db_tables.name', 'db_tables.row_count'],
      limit: 10
    };

    try {
      // Mismatched workspaceId should fail validation
      await validator.validateAndResolve('wrong_workspace_id', testConnectionId, validPlan);
      throw new Error('Assertion failed: Validator allowed connection to execute under wrong workspaceId.');
    } catch (err: any) {
      if (err.message.includes('breach')) {
        console.log('✓ Successfully blocked mismatched workspaceId (Tenant Isolation Breach prevented).');
      } else {
        throw err;
      }
    }

    // 5. Test Blocklisted Queries Validation (Security Checks)
    console.log('[Test] Testing blocklist table/column checks...');
    const blockedTablePlan = {
      operation: 'SELECT' as const,
      tables: ['user_passwords'], // Contains blocked term 'password' or 'user'
      fields: ['id', 'username'],
      limit: 5
    };

    try {
      await validator.validateAndResolve('test_workspace_alpha', testConnectionId, blockedTablePlan);
      throw new Error('Assertion failed: Validator allowed querying of blocked table.');
    } catch (err: any) {
      if (err.message.includes('blocked') || err.message.includes('security')) {
        console.log('✓ Successfully blocked unsafe table query.');
      } else {
        throw err;
      }
    }

    // 6. Test Query Plan Compilation
    console.log('[Test] Compiling QueryPlan into parameterized SQL...');
    const validatedPlan = await validator.validateAndResolve('test_workspace_alpha', testConnectionId, validPlan);
    const compiled = compiler.compile(validatedPlan, connRecord.provider);

    console.log('Compiled SQL:', compiled.sql);
    console.log('Compiled parameters:', compiled.params);

    if (!compiled.sql.includes('SELECT "db_tables"."name", "db_tables"."row_count" FROM "db_tables"')) {
      throw new Error('Assertion failed: Compiled SQL syntax is incorrect.');
    }
    console.log('✓ Parameterized SQL compiled correctly.');

    // 7. Test Parameterized Query Execution
    console.log('[Test] Executing read query on local database...');
    // Register the schema tables in metadata db first so query validator has access
    await intelRepo.saveTablesMetadata(testConnectionId, schema.tables);
    
    // Validate and run query
    const rows = await readExecutor.execute(testConnectionId, compiled);
    console.log(`✓ Query executed successfully. Returned ${rows.length} rows.`);

    // 8. Test Session Memory variable substitution
    console.log('[Test] Testing session memory placeholder resolution...');
    sessionMemory.setEntity('session_abc', 'target_table_name', 'db_connections');
    
    const sessionPlan = {
      operation: 'SELECT' as const,
      tables: ['db_tables'],
      fields: ['db_tables.name'],
      filters: [{
        column: 'db_tables.name',
        operator: '=' as const,
        value: '{{target_table_name}}' // Placeholders resolved at runtime
      }],
      limit: 5
    };

    const resolvedPlan = await validator.validateAndResolve('test_workspace_alpha', testConnectionId, sessionPlan, 'session_abc');
    if (!resolvedPlan.filters || resolvedPlan.filters[0].value !== 'db_connections') {
      throw new Error('Assertion failed: Session variable did not resolve to "db_connections".');
    }
    console.log('✓ Session placeholder successfully resolved to "db_connections".');

    console.log('\n======================================================');
    console.log('✓ ALL DATABASE INTELLIGENCE LAYER INTEGRATION TESTS PASSED!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  } finally {
    // 9. Clean up test connection
    console.log('[Cleanup] Deleting test database connection...');
    await intelRepo.deleteConnection(testConnectionId);
    console.log('✓ Test connection cleaned up.');
  }
}

runTests();
