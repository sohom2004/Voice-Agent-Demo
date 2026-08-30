import { IntelRepository } from '../storage/intelRepository';
import { getConnector } from '../discovery/schema_inspector';
import { CompiledQuery } from './query_compiler';

export class ReadExecutor {
  private intelRepo = new IntelRepository();

  /**
   * Fetches the connection details, decrypts credentials, executes the compiled SQL query, and returns results.
   */
  async execute(connectionId: string, compiledQuery: CompiledQuery, timeoutMs = 3000): Promise<any[]> {
    const connection = await this.intelRepo.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Database connection ${connectionId} not found.`);
    }

    const connector = getConnector(connection.provider, connection.connectionConfig);
    try {
      await connector.connect();
      
      const latencyStart = Date.now();
      const rows = await connector.executeRead(compiledQuery.sql, compiledQuery.params, timeoutMs);
      const latencyMs = Date.now() - latencyStart;
      
      console.log(`[Read Executor] Executed query on connection ${connectionId} (provider: ${connection.provider}). Latency: ${latencyMs}ms. Row count: ${rows.length}`);
      
      return rows;
    } finally {
      await connector.disconnect();
    }
  }
}
