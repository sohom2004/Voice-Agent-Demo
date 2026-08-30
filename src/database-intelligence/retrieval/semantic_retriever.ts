import { pool } from '../../storage/dbSetup';
import { EmbeddingProvider } from '../../knowledge-ingestion/embeddingProvider';

export interface SemanticMatchResult {
  tableId: string;
  tableName: string;
  schemaName: string;
  similarity: number;
}

export interface CapabilityMatchResult {
  id: string;
  name: string;
  type: 'READ' | 'WRITE';
  description: string;
  requiredContext: string[];
  relevantTables: string[];
  permissions: string[];
  similarity: number;
}

export class SemanticRetriever {
  private embedProvider = new EmbeddingProvider();

  /**
   * Retrieves tables matching user query semantically.
   */
  async retrieveTables(
    connectionId: string, 
    queryText: string, 
    threshold = 0.45, 
    limit = 5
  ): Promise<SemanticMatchResult[]> {
    if (!queryText.trim()) return [];

    const queryEmbed = await this.embedProvider.embed(queryText);
    const vectorLiteral = `[${queryEmbed.join(',')}]`;

    // Detect pgvector support
    const vectorCheck = await pool.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
    const usePgVector = vectorCheck.rows.length > 0;

    let query = '';
    let values: any[] = [];

    if (usePgVector) {
      query = `
        SELECT t.id, t.name, t.schema_name, (1 - (s.embedding <=> $2::vector)) AS score
        FROM db_tables t
        JOIN db_semantic_metadata s ON s.table_id = t.id
        WHERE t.connection_id = $1
          AND (1 - (s.embedding <=> $2::vector)) >= $3
        ORDER BY score DESC
        LIMIT $4;
      `;
      values = [connectionId, vectorLiteral, threshold, limit];
    } else {
      query = `
        SELECT t.id, t.name, t.schema_name, cosine_similarity(s.embedding, $2::real[]) AS score
        FROM db_tables t
        JOIN db_semantic_metadata s ON s.table_id = t.id
        WHERE t.connection_id = $1
          AND cosine_similarity(s.embedding, $2::real[]) >= $3
        ORDER BY score DESC
        LIMIT $4;
      `;
      values = [connectionId, queryEmbed, threshold, limit];
    }

    const res = await pool.query(query, values);
    return res.rows.map(row => ({
      tableId: row.id,
      tableName: row.name,
      schemaName: row.schema_name,
      similarity: row.score
    }));
  }

  /**
   * Retrieves logical capabilities matching user query semantically.
   */
  async retrieveCapabilities(
    connectionId: string, 
    queryText: string, 
    threshold = 0.45, 
    limit = 3
  ): Promise<CapabilityMatchResult[]> {
    if (!queryText.trim()) return [];

    const queryEmbed = await this.embedProvider.embed(queryText);
    const vectorLiteral = `[${queryEmbed.join(',')}]`;

    const vectorCheck = await pool.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
    const usePgVector = vectorCheck.rows.length > 0;

    let query = '';
    let values: any[] = [];

    if (usePgVector) {
      query = `
        SELECT id, name, type, description, required_context, relevant_tables, permissions,
               (1 - (embedding <=> $2::vector)) AS score
        FROM db_capabilities
        WHERE connection_id = $1
          AND (1 - (embedding <=> $2::vector)) >= $3
        ORDER BY score DESC
        LIMIT $4;
      `;
      values = [connectionId, vectorLiteral, threshold, limit];
    } else {
      query = `
        SELECT id, name, type, description, required_context, relevant_tables, permissions,
               cosine_similarity(embedding, $2::real[]) AS score
        FROM db_capabilities
        WHERE connection_id = $1
          AND cosine_similarity(embedding, $2::real[]) >= $3
        ORDER BY score DESC
        LIMIT $4;
      `;
      values = [connectionId, queryEmbed, threshold, limit];
    }

    const res = await pool.query(query, values);
    return res.rows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type as 'READ' | 'WRITE',
      description: row.description,
      requiredContext: row.required_context,
      relevantTables: row.relevant_tables,
      permissions: row.permissions,
      similarity: row.score
    }));
  }
}
