import { IntelRepository } from '../storage/intelRepository';
import { SchemaInspector } from '../discovery/schema_inspector';
import { DataSampler } from '../discovery/data_sampler';
import { SemanticAnalyzer } from '../intelligence/semantic_analyzer';
import { getConnector } from '../discovery/schema_inspector';
import { pool } from '../../storage/dbSetup';

export class SchemaRefresh {
  private intelRepo = new IntelRepository();
  private inspector = new SchemaInspector();
  private sampler = new DataSampler();
  private analyzer = new SemanticAnalyzer();

  /**
   * Performs an incremental schema refresh.
   * Compares the live database schema with the stored metadata and regenerates semantic analyses only where necessary.
   */
  async refresh(connectionId: string): Promise<{
    addedTables: string[];
    removedTables: string[];
    updatedTables: string[];
  }> {
    const connection = await this.intelRepo.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Database connection ${connectionId} not found.`);
    }

    // 1. Get existing stored tables
    const storedTables = await this.intelRepo.getTablesMetadata(connectionId);
    const storedTablesMap = new Map(storedTables.map(t => [t.name, t]));

    // 2. Fetch live schema
    const liveSchema = await this.inspector.inspect(connection.provider, connection.connectionConfig);
    const liveTablesMap = new Map(liveSchema.tables.map(t => [t.name, t]));

    const addedTables: string[] = [];
    const removedTables: string[] = [];
    const updatedTables: string[] = [];

    // Identify changes
    for (const tableName of liveTablesMap.keys()) {
      if (!storedTablesMap.has(tableName)) {
        addedTables.push(tableName);
      } else {
        // Simple comparison: check if column count has changed
        const liveTable = liveTablesMap.get(tableName)!;
        
        // Find existing column metadata
        const storedTable = storedTablesMap.get(tableName)!;
        const storedCols = await this.intelRepo.getTableColumns(storedTable.id);
        
        if (liveTable.columns.length !== storedCols.length) {
          updatedTables.push(tableName);
        }
      }
    }

    for (const tableName of storedTablesMap.keys()) {
      if (!liveTablesMap.has(tableName)) {
        removedTables.push(tableName);
      }
    }

    console.log(`[Schema Refresh] Connection ${connectionId} changes detected: Added: ${addedTables.join(', ')} | Removed: ${removedTables.join(', ')} | Updated: ${updatedTables.join(', ')}`);

    if (addedTables.length === 0 && removedTables.length === 0 && updatedTables.length === 0) {
      // Nothing changed, return early
      return { addedTables, removedTables, updatedTables };
    }

    // 3. Save updated structural schema & relationships
    const tableIdMap = await this.intelRepo.saveTablesMetadata(connectionId, liveSchema.tables);
    await this.intelRepo.saveRelationships(connectionId, liveSchema.relationships);

    // 4. Regenerate semantic metadata ONLY for new or updated tables
    const connector = getConnector(connection.provider, connection.connectionConfig);
    try {
      await connector.connect();

      for (const [tableName, tableId] of tableIdMap.entries()) {
        const isNewOrUpdated = addedTables.includes(tableName) || updatedTables.includes(tableName);
        
        if (isNewOrUpdated) {
          console.log(`[Schema Refresh] Regenerating semantic descriptions for table: ${tableName}`);
          const liveTable = liveTablesMap.get(tableName)!;
          const maskedSample = await this.sampler.sampleAndMask(connector, tableName, 10);
          
          const semantic = await this.analyzer.analyzeTable(liveTable, maskedSample);
          const embedding = await this.analyzer.generateEmbedding(semantic.description);

          await this.intelRepo.saveSemanticMetadata(
            tableId,
            semantic.description,
            semantic.businessConcepts,
            semantic.synonyms,
            embedding
          );
        } else {
          // Carry over previous semantic metadata
          const oldTable = storedTablesMap.get(tableName);
          if (oldTable) {
            // Find existing semantic info
            const res = await this.intelRepo.getTablesMetadata(connectionId);
            const newTableRecord = res.find(t => t.name === tableName);
            
            const oldSemRes = await pool.query(
              'SELECT semantic_description, business_concepts, synonyms, embedding FROM db_semantic_metadata WHERE table_id = $1',
              [oldTable.id]
            );

            if (oldSemRes.rows.length > 0 && newTableRecord) {
              const row = oldSemRes.rows[0];
              
              // We convert the float/vector format back to array if needed
              let embedding: number[] | undefined;
              if (row.embedding) {
                // If it is stored as database vector or array string representation
                if (typeof row.embedding === 'string') {
                  embedding = row.embedding.replace(/[\[\]]/g, '').split(',').map(Number);
                } else if (Array.isArray(row.embedding)) {
                  embedding = row.embedding.map(Number);
                }
              }

              await this.intelRepo.saveSemanticMetadata(
                newTableRecord.id,
                row.semantic_description,
                row.business_concepts,
                row.synonyms,
                embedding
              );
            }
          }
        }
      }

      // 5. Regenerate logical capabilities
      console.log('[Schema Refresh] Re-analyzing database capabilities...');
      const capabilities = await this.analyzer.generateCapabilities(liveSchema.tables);
      
      const capabilitiesWithEmbeds = await Promise.all(
        capabilities.map(async cap => {
          const embedding = await this.analyzer.generateEmbedding(cap.description);
          return { ...cap, embedding };
        })
      );

      await this.intelRepo.saveCapabilities(connectionId, capabilitiesWithEmbeds);

    } finally {
      await connector.disconnect();
    }

    return { addedTables, removedTables, updatedTables };
  }
}
