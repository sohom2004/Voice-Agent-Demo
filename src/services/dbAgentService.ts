import { DatabaseAgent, createAdapter, type ExecutionResult, type ConnectionConfig } from '../../db-agent/src';
import { EventEmitter } from 'events';

export interface DebugLogEvent {
  id: string;
  timestamp: string;
  type: 'INFO' | 'SPEECH_TRANSCRIPTION' | 'DB_INTROSPECTION' | 'TOOL_CALL' | 'GUARDRAIL_CHECK' | 'CONTEXT_PAYLOAD' | 'ERROR';
  source: 'natasha_voice' | 'db_agent' | 'rag_engine' | 'system';
  message: string;
  details?: any;
}

export class DbAgentService extends EventEmitter {
  private tenantAgents = new Map<string, DatabaseAgent>();
  private logs: DebugLogEvent[] = [];
  private lastSyncedHash = new Map<string, string>();

  constructor() {
    super();
  }

  public log(
    type: DebugLogEvent['type'],
    message: string,
    details?: any,
    source: DebugLogEvent['source'] = 'db_agent'
  ) {
    const event: DebugLogEvent = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      type,
      source,
      message,
      details
    };
    this.logs.unshift(event);
    if (this.logs.length > 500) {
      this.logs.pop();
    }
    this.emit('log', event);
    console.log(`[${event.source.toUpperCase()}] [${event.type}] ${event.message}`);
  }

  public getLogs(): DebugLogEvent[] {
    return this.logs;
  }

  public async getAgentForTenant(
    tenantId: string = 'default_tenant',
    configOverride?: Partial<ConnectionConfig>
  ): Promise<DatabaseAgent> {
    let agent = this.tenantAgents.get(tenantId);
    if (!agent) {
      const defaultDialect = process.env.DB_DIALECT as any || (process.env.DB_HOST ? 'postgres' : 'sqlite');
      const config: ConnectionConfig = {
        tenantId,
        dialect: defaultDialect,
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || (defaultDialect === 'sqlite' ? 'demo_database.db' : 'acme_test'),
        ...configOverride
      };

      if (config.dialect === 'sqlite') {
        await ensureDemoSqliteDatabase(config.database || 'demo_database.db');
      }

      this.log('INFO', `Initializing db-agent for tenant '${tenantId}' (${config.dialect})`, config);
      agent = new DatabaseAgent(config);
      await agent.syncManifest();
      const snapshot = await agent.getSnapshot();
      this.lastSyncedHash.set(tenantId, snapshot.hash);
      this.log(
        'DB_INTROSPECTION',
        `Database schema synced for '${tenantId}' (${snapshot.tables.length} tables introspected)`,
        {
          hash: snapshot.hash,
          tables: snapshot.tables.map(t => ({
            name: t.name,
            columnCount: t.columns.length,
            columns: t.columns.map(c => `${c.name} (${c.dataType}${c.isPrimaryKey ? ' PK' : ''}${c.isForeignKey ? ' FK' : ''})`)
          }))
        }
      );
      this.tenantAgents.set(tenantId, agent);
    }

    return agent;
  }

  public async registerNewDatabase(
    tenantId: string = 'default_tenant',
    config: ConnectionConfig
  ): Promise<any> {
    if (this.tenantAgents.has(tenantId)) {
      try {
        const oldAgent = this.tenantAgents.get(tenantId);
        await oldAgent?.disconnect();
      } catch (err) {}
      this.tenantAgents.delete(tenantId);
    }

    this.log('INFO', `Registering & connecting new database for tenant '${tenantId}' (${config.dialect})`, config);
    const agent = new DatabaseAgent(config);
    this.tenantAgents.set(tenantId, agent);

    await agent.syncManifest();
    const snapshot = await agent.getSnapshot();
    const tools = agent.getToolSchemas();

    this.log('DB_INTROSPECTION', `Successfully connected & compiled manifest for new database '${config.database || config.host}'`, {
      tableCount: snapshot.tables.length,
      toolCount: tools.length
    });

    return this.getDbColumnContext(tenantId);
  }

  public async getToolSchemasForNatasha(tenantId: string = 'default_tenant') {
    const agent = await this.getAgentForTenant(tenantId);
    const schemas = agent.getToolSchemas();

    // Convert getToolSchemas() format to standard function calling parameters
    const tools = schemas.map((s) => ({
      type: 'function' as const,
      function: {
        name: s.name,
        description: s.description,
        parameters: s.input_schema
      }
    }));

    this.log(
      'CONTEXT_PAYLOAD',
      `Compiled ${tools.length} db-agent tool schemas for Natasha voice agent`,
      tools.map(t => ({ name: t.function.name, description: t.function.description }))
    );

    return tools;
  }

  public async handleToolCall(
    tenantId: string = 'default_tenant',
    toolName: string,
    args: any,
    opts: { confirmed?: boolean } = {}
  ): Promise<{ speak: string; result: ExecutionResult }> {
    console.log('\n' + '='.repeat(80));
    console.log(`[DB PIPELINE STAGE 1: TOOL SELECTION & INPUT ARGS]`);
    console.log(`  ➜ Tenant ID:     ${tenantId}`);
    console.log(`  ➜ Tool Name:     ${toolName}`);
    console.log(`  ➜ Input Args:    ${JSON.stringify(args, null, 2)}`);
    console.log(`  ➜ Options:       ${JSON.stringify(opts)}`);

    this.log('TOOL_CALL', `[Stage 1: Tool Call] Requested tool '${toolName}'`, { toolName, args, opts }, 'natasha_voice');

    try {
      const agent = await this.getAgentForTenant(tenantId);
      const manifest = agent.getManifest();
      const toolDef = manifest.tools.find(t => t.name === toolName);

      console.log(`\n[DB PIPELINE STAGE 2: MANIFEST & GUARDRAIL VALIDATION]`);
      console.log(`  ➜ Target Table:  ${toolDef?.table || 'N/A'}`);
      console.log(`  ➜ Operation:     ${toolDef?.operation || 'READ'}`);
      console.log(`  ➜ Is Write Op:   ${toolDef?.isWrite ? 'YES (Confirmation Gated)' : 'NO (Read-only)'}`);

      const startTime = Date.now();
      const result = await agent.callTool(toolName, args, opts);
      const durationMs = Date.now() - startTime;

      console.log(`\n[DB PIPELINE STAGE 3 & 4: EXECUTION & RAW DATABASE RESULTS]`);
      console.log(`  ➜ Status:        ${result.status}`);
      console.log(`  ➜ Execution Time:${durationMs}ms`);

      if (result.status === 'ok') {
        const rowCount = Array.isArray(result.data) ? result.data.length : (result.data ? 1 : 0);
        console.log(`  ➜ Rows Returned: ${rowCount}`);
        console.log(`  ➜ Raw Payload:   ${JSON.stringify(result.data, null, 2)}`);
      } else {
        console.log(`  ➜ Result Payload: ${JSON.stringify(result, null, 2)}`);
      }
      console.log('='.repeat(80) + '\n');

      this.log(
        'GUARDRAIL_CHECK',
        `[Stage 3-4: DB Execution] ${toolName} -> status='${result.status}' (${durationMs}ms)`,
        { toolName, args, result, durationMs }
      );

      switch (result.status) {
        case 'ok': {
          const speakText = result.data
            ? `Here are the details from database: ${JSON.stringify(result.data)}`
            : 'No matching records found in database.';
          return { speak: speakText, result };
        }
        case 'confirmation_required': {
          return {
            speak: `Confirmation required: Are you sure you want to ${result.pendingChange}?`,
            result
          };
        }
        case 'not_found': {
          return {
            speak: `The requested operation ${toolName} was not found in database manifest.`,
            result
          };
        }
        case 'error': {
          return {
            speak: `Database query encountered an issue: ${result.error}`,
            result
          };
        }
      }
    } catch (err: any) {
      console.error(`[DB PIPELINE STAGE ERROR] Tool call '${toolName}' failed:`, err);
      this.log('ERROR', `Tool call '${toolName}' execution failed: ${err.message}`, { error: err.stack });
      return {
        speak: `I encountered a database error executing ${toolName}.`,
        result: { status: 'error', error: err.message }
      };
    }
  }

  public async getDbColumnContext(tenantId: string = 'default_tenant') {
    try {
      const agent = await this.getAgentForTenant(tenantId);
      await agent.syncManifest();
      const snapshot = await agent.getSnapshot();
      const tools = agent.getToolSchemas();

      return {
        tenantId,
        dialect: snapshot.dialect,
        schemaHash: snapshot.hash,
        fetchedAt: snapshot.fetchedAt,
        tableCount: snapshot.tables.length,
        tables: snapshot.tables.map(t => ({
          name: t.name,
          columnCount: t.columns.length,
          columns: t.columns.map(c => ({
            name: c.name,
            dataType: c.dataType,
            isNullable: c.isNullable,
            isPrimaryKey: c.isPrimaryKey,
            isForeignKey: c.isForeignKey,
            referencesTable: c.referencesTable,
            referencesColumn: c.referencesColumn
          }))
        })),
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema
        }))
      };
    } catch (err: any) {
      this.log('ERROR', `Failed to retrieve DB column context: ${err.message}`);
      return {
        tenantId,
        error: err.message,
        tables: [],
        tools: []
      };
    }
  }
}

export const dbAgentService = new DbAgentService();

async function ensureDemoSqliteDatabase(dbPath: string = 'demo_database.db') {
  try {
    const fs = await import('fs');
    if (!fs.existsSync(dbPath)) {
      const adapter = createAdapter({
        tenantId: 'seed',
        dialect: 'sqlite',
        database: dbPath,
        host: '',
        port: 0,
        user: '',
        password: ''
      });
      const knex = adapter.getKnex();

      const hasPatients = await knex.schema.hasTable('patients');
      if (!hasPatients) {
        await knex.schema.createTable('patients', table => {
          table.string('patient_id').primary();
          table.string('name').notNullable();
          table.integer('age');
          table.string('gender');
          table.string('diagnosis');
        });

        await knex('patients').insert([
          { patient_id: 'P101', name: 'Alice Smith', age: 34, gender: 'Female', diagnosis: 'Hypertension' },
          { patient_id: 'P102', name: 'Bob Jones', age: 58, gender: 'Male', diagnosis: 'Type 2 Diabetes' },
          { patient_id: 'P103', name: 'Charlie Brown', age: 45, gender: 'Male', diagnosis: 'Hyperlipidemia' }
        ]);
      }

      const hasLabResults = await knex.schema.hasTable('lab_results');
      if (!hasLabResults) {
        await knex.schema.createTable('lab_results', table => {
          table.increments('id').primary();
          table.string('patient_id').references('patients.patient_id');
          table.string('test_name');
          table.float('result_value');
          table.string('unit');
          table.string('test_date');
        });

        await knex('lab_results').insert([
          { patient_id: 'P101', test_name: 'Blood Pressure Systolic', result_value: 138.0, unit: 'mmHg', test_date: '2026-08-15' },
          { patient_id: 'P101', test_name: 'Cholesterol Total', result_value: 210.0, unit: 'mg/dL', test_date: '2026-08-15' },
          { patient_id: 'P102', test_name: 'HbA1c', result_value: 7.8, unit: '%', test_date: '2026-08-20' },
          { patient_id: 'P102', test_name: 'Fasting Glucose', result_value: 145.0, unit: 'mg/dL', test_date: '2026-08-20' }
        ]);
      }

      await knex.destroy();
    }
  } catch (err) {
    console.warn('[DbAgentService] Failed to seed demo SQLite database:', err);
  }
}
