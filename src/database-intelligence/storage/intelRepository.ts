import { pool } from '../../storage/dbSetup';
import { TableMetadata, RelationshipMetadata } from '../connectors/base';

export interface DbConnectionRecord {
  id: string;
  workspaceId: string;
  name: string;
  provider: 'postgres' | 'mysql';
  connectionConfig: string; // Encrypted JSON
  status: 'disconnected' | 'connected' | 'analyzing' | 'ready' | 'failed';
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbTableRecord {
  id: string;
  connectionId: string;
  name: string;
  schemaName: string;
  description?: string;
  rowCount: number;
}

export interface DbColumnRecord {
  id: string;
  tableId: string;
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  defaultValue?: string;
  description?: string;
  classification: 'normal' | 'sensitive' | 'highly_sensitive';
}

export interface DbSemanticRecord {
  id: string;
  tableId: string;
  semanticDescription: string;
  businessConcepts: string[];
  synonyms: string[];
  embedding?: number[];
}

export interface DbCapabilityRecord {
  id: string;
  connectionId: string;
  name: string;
  type: 'READ' | 'WRITE';
  description: string;
  requiredContext: string[];
  relevantTables: string[];
  permissions: string[];
  embedding?: number[];
}

export class IntelRepository {
  async createConnection(record: Omit<DbConnectionRecord, 'createdAt' | 'updatedAt'>): Promise<DbConnectionRecord> {
    const res = await pool.query(`
      INSERT INTO db_connections (id, workspace_id, name, provider, connection_config, status, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `, [record.id, record.workspaceId, record.name, record.provider, record.connectionConfig, record.status, record.error]);
    
    return this.mapConnectionRow(res.rows[0]);
  }

  async updateConnectionStatus(id: string, status: string, error?: string): Promise<void> {
    await pool.query(`
      UPDATE db_connections
      SET status = $2, error = $3, updated_at = NOW()
      WHERE id = $1;
    `, [id, status, error || null]);
  }

  async listConnections(workspaceId: string): Promise<DbConnectionRecord[]> {
    const res = await pool.query(`
      SELECT * FROM db_connections
      WHERE workspace_id = $1
      ORDER BY created_at DESC;
    `, [workspaceId]);
    
    return res.rows.map(row => this.mapConnectionRow(row));
  }

  async getConnection(id: string): Promise<DbConnectionRecord | null> {
    const res = await pool.query(`
      SELECT * FROM db_connections
      WHERE id = $1;
    `, [id]);
    
    if (res.rows.length === 0) return null;
    return this.mapConnectionRow(res.rows[0]);
  }

  async deleteConnection(id: string): Promise<void> {
    await pool.query(`
      DELETE FROM db_connections
      WHERE id = $1;
    `, [id]);
  }

  async saveTablesMetadata(connectionId: string, tables: TableMetadata[]): Promise<Map<string, string>> {
    // Return map of TableName -> TableId for downstream lookups
    const tableIdMap = new Map<string, string>();
    
    // We execute inside a transaction to prevent partial schema loads
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Delete existing tables (cascade will remove columns and semantic metadata)
      await client.query('DELETE FROM db_tables WHERE connection_id = $1', [connectionId]);

      for (const table of tables) {
        const tableId = `tbl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        tableIdMap.set(table.name, tableId);

        await client.query(`
          INSERT INTO db_tables (id, connection_id, name, schema_name, description, row_count)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [tableId, connectionId, table.name, table.schemaName, null, table.rowCount || 0]);

        for (const col of table.columns) {
          const colId = `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          
          // Classify sensitive columns based on standard names
          const classification = this.detectColumnClassification(col.name);

          await client.query(`
            INSERT INTO db_columns (id, table_id, name, data_type, is_nullable, is_primary_key, is_foreign_key, default_value, classification)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            colId,
            tableId,
            col.name,
            col.dataType,
            col.isNullable,
            col.isPrimaryKey,
            col.isForeignKey,
            col.defaultValue || null,
            classification
          ]);
        }
      }

      await client.query('COMMIT');
      return tableIdMap;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveRelationships(connectionId: string, relationships: RelationshipMetadata[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query('DELETE FROM db_relationships WHERE connection_id = $1', [connectionId]);

      for (const rel of relationships) {
        const relId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await client.query(`
          INSERT INTO db_relationships (id, connection_id, source_table, source_column, target_table, target_column, relationship_type)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          relId,
          connectionId,
          rel.sourceTable,
          rel.sourceColumn,
          rel.targetTable,
          rel.targetColumn,
          rel.relationshipType
        ]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveSemanticMetadata(
    tableId: string, 
    description: string, 
    concepts: string[], 
    synonyms: string[], 
    embedding?: number[]
  ): Promise<void> {
    const semId = `sem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    
    // Check if pgvector extension is enabled
    const vectorCheck = await pool.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
    const usePgVector = vectorCheck.rows.length > 0;
    
    let embedValue: string | null = null;
    if (embedding) {
      embedValue = usePgVector 
        ? `[${embedding.join(',')}]` 
        : `{${embedding.join(',')}}`;
    }

    // Use INSERT ... ON CONFLICT to allow updates
    await pool.query(`
      INSERT INTO db_semantic_metadata (id, table_id, semantic_description, business_concepts, synonyms, embedding, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (table_id) DO UPDATE
      SET semantic_description = EXCLUDED.semantic_description,
          business_concepts = EXCLUDED.business_concepts,
          synonyms = EXCLUDED.synonyms,
          embedding = COALESCE(EXCLUDED.embedding, db_semantic_metadata.embedding),
          updated_at = NOW();
    `, [semId, tableId, description, concepts, synonyms, embedValue]);
  }

  async saveCapabilities(connectionId: string, capabilities: Omit<DbCapabilityRecord, 'id' | 'connectionId'>[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Delete existing connection capabilities
      await client.query('DELETE FROM db_capabilities WHERE connection_id = $1', [connectionId]);

      // Check if pgvector extension is enabled
      const vectorCheck = await client.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
      const usePgVector = vectorCheck.rows.length > 0;

      for (const cap of capabilities) {
        const capId = `cap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        
        let embedValue: string | null = null;
        if (cap.embedding) {
          embedValue = usePgVector 
            ? `[${cap.embedding.join(',')}]` 
            : `{${cap.embedding.join(',')}}`;
        }

        await client.query(`
          INSERT INTO db_capabilities (id, connection_id, name, type, description, required_context, relevant_tables, permissions, embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          capId,
          connectionId,
          cap.name,
          cap.type,
          cap.description,
          cap.requiredContext,
          cap.relevantTables,
          cap.permissions,
          embedValue
        ]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getTablesMetadata(connectionId: string): Promise<DbTableRecord[]> {
    const res = await pool.query('SELECT * FROM db_tables WHERE connection_id = $1', [connectionId]);
    return res.rows.map(row => ({
      id: row.id,
      connectionId: row.connection_id,
      name: row.name,
      schemaName: row.schema_name,
      description: row.description || undefined,
      rowCount: row.row_count
    }));
  }

  async getTableColumns(tableId: string): Promise<DbColumnRecord[]> {
    const res = await pool.query('SELECT * FROM db_columns WHERE table_id = $1', [tableId]);
    return res.rows.map(row => ({
      id: row.id,
      tableId: row.table_id,
      name: row.name,
      dataType: row.data_type,
      isNullable: row.is_nullable,
      isPrimaryKey: row.is_primary_key,
      isForeignKey: row.is_foreign_key,
      defaultValue: row.default_value || undefined,
      description: row.description || undefined,
      classification: row.classification
    }));
  }

  async getRelationships(connectionId: string): Promise<RelationshipMetadata[]> {
    const res = await pool.query('SELECT * FROM db_relationships WHERE connection_id = $1', [connectionId]);
    return res.rows.map(row => ({
      sourceTable: row.source_table,
      sourceColumn: row.source_column,
      targetTable: row.target_table,
      targetColumn: row.target_column,
      relationshipType: row.relationship_type
    }));
  }

  private detectColumnClassification(colName: string): 'normal' | 'sensitive' | 'highly_sensitive' {
    const name = colName.toLowerCase();
    const highlySensitiveTerms = ['password', 'secret', 'token', 'api_key', 'cvv', 'ssn', 'aadhaar', 'pass_hash', 'credit_card'];
    const sensitiveTerms = ['phone', 'email', 'address', 'dob', 'salary', 'income', 'balance', 'name'];

    if (highlySensitiveTerms.some(term => name.includes(term))) {
      return 'highly_sensitive';
    }
    if (sensitiveTerms.some(term => name.includes(term))) {
      return 'sensitive';
    }
    return 'normal';
  }

  private mapConnectionRow(row: any): DbConnectionRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      provider: row.provider,
      connectionConfig: row.connection_config,
      status: row.status,
      error: row.error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
