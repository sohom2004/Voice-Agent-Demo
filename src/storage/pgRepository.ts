import { Pool } from 'pg';
import { 
  DocumentRepository, 
  ChunkRepository 
} from '../shared/interfaces';
import { 
  DocumentRecord, 
  DocumentChunk, 
  RetrievedChunk 
} from '../shared/types';
import { pool } from './dbSetup';

export class PgDocumentRepository implements DocumentRepository {
  private db: Pool;

  constructor(db: Pool = pool) {
    this.db = db;
  }

  async create(doc: Omit<DocumentRecord, 'createdAt' | 'updatedAt'>): Promise<DocumentRecord> {
    const query = `
      INSERT INTO documents (id, workspace_id, name, file_type, storage_path, status, error, size, uploaded_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const values = [
      doc.id,
      doc.workspaceId,
      doc.name,
      doc.fileType,
      doc.storagePath,
      doc.status,
      doc.error || null,
      doc.size,
      doc.uploadedAt
    ];
    const res = await this.db.query(query, values);
    const row = res.rows[0];
    return this.mapRowToRecord(row);
  }

  async get(id: string): Promise<DocumentRecord | null> {
    const query = 'SELECT * FROM documents WHERE id = $1;';
    const res = await this.db.query(query, [id]);
    if (res.rows.length === 0) return null;
    return this.mapRowToRecord(res.rows[0]);
  }

  async list(workspaceId: string): Promise<DocumentRecord[]> {
    const query = 'SELECT * FROM documents WHERE workspace_id = $1 ORDER BY created_at DESC;';
    const res = await this.db.query(query, [workspaceId]);
    return res.rows.map(row => this.mapRowToRecord(row));
  }

  async updateStatus(id: string, status: DocumentRecord['status'], error?: string): Promise<void> {
    const query = `
      UPDATE documents 
      SET status = $1, error = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3;
    `;
    await this.db.query(query, [status, error || null, id]);
  }

  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM documents WHERE id = $1;';
    const res = await this.db.query(query, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async getUnprocessed(): Promise<DocumentRecord[]> {
    const query = "SELECT * FROM documents WHERE status = 'uploaded' OR status = 'processing' ORDER BY created_at ASC;";
    const res = await this.db.query(query);
    return res.rows.map(row => this.mapRowToRecord(row));
  }

  private mapRowToRecord(row: any): DocumentRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      fileType: row.file_type,
      storagePath: row.storage_path,
      status: row.status,
      error: row.error,
      size: row.size,
      uploadedAt: parseInt(row.uploaded_at),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export class PgChunkRepository implements ChunkRepository {
  private db: Pool;

  constructor(db: Pool = pool) {
    this.db = db;
  }

  async createBatch(chunks: Omit<DocumentChunk, 'id'>[], embeddings: number[][]): Promise<void> {
    if (chunks.length === 0) return;

    // We detect whether the table is pgvector-enabled or fallback-enabled
    // by querying table description or extension setup.
    // For absolute robustness, we try to see if a simple vector insert throws.
    // If we fail, we format as SQL array literal '{...}' or pg driver array.
    // To be clean, let's check table definition or try to read the column type.
    const typeCheck = await this.db.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'document_chunks' AND column_name = 'embedding';
    `);
    const isVectorType = typeCheck.rows[0]?.data_type === 'USER-DEFINED'; // pgvector is USER-DEFINED

    const client = await this.db.connect();
    try {
      await client.query('BEGIN;');
      
      const query = `
        INSERT INTO document_chunks (id, workspace_id, document_id, document_name, section_path, chunk_index, content, metadata, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        const id = `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        
        // Format embedding based on database column type
        // pgvector requires string '[1.0,2.0,...]'
        // real[] requires JS array [1.0, 2.0, ...]
        const formattedEmbedding = isVectorType 
          ? `[${embedding.join(',')}]` 
          : embedding; // pg driver converts JS number[] to PG real[]

        const values = [
          id,
          chunk.workspaceId,
          chunk.documentId,
          chunk.documentName,
          chunk.sectionPath,
          chunk.chunkIndex,
          chunk.content,
          JSON.stringify(chunk.metadata),
          formattedEmbedding
        ];

        await client.query(query, values);
      }

      await client.query('COMMIT;');
    } catch (err) {
      await client.query('ROLLBACK;');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    const query = 'DELETE FROM document_chunks WHERE document_id = $1;';
    await this.db.query(query, [documentId]);
  }

  async searchVector(
    embedding: number[], 
    workspaceId: string, 
    activeDocumentIds: string[] | undefined, 
    limit: number,
    usePgVector: boolean
  ): Promise<RetrievedChunk[]> {
    let query: string;
    let values: any[];

    const activeDocsFilter = activeDocumentIds && activeDocumentIds.length > 0 
      ? 'AND document_id = ANY($3)' 
      : '';

    if (usePgVector) {
      // <=> is the cosine distance operator in pgvector. Distance = 1 - cosine_similarity.
      // So score = 1 - distance = 1 - (embedding <=> query_embedding)
      query = `
        SELECT id, document_id, document_name, section_path, chunk_index, content, metadata,
               (1 - (embedding <=> $1::vector)) AS score
        FROM document_chunks
        WHERE workspace_id = $2 ${activeDocsFilter}
        ORDER BY embedding <=> $1::vector
        LIMIT ${limit};
      `;
      values = [
        `[${embedding.join(',')}]`,
        workspaceId,
        ...(activeDocumentIds && activeDocumentIds.length > 0 ? [activeDocumentIds] : [])
      ];
    } else {
      // Fallback SQL search using cosine_similarity function
      query = `
        SELECT id, document_id, document_name, section_path, chunk_index, content, metadata,
               cosine_similarity(embedding, $1::real[]) AS score
        FROM document_chunks
        WHERE workspace_id = $2 ${activeDocsFilter}
        ORDER BY score DESC
        LIMIT ${limit};
      `;
      values = [
        embedding,
        workspaceId,
        ...(activeDocumentIds && activeDocumentIds.length > 0 ? [activeDocumentIds] : [])
      ];
    }

    const res = await this.db.query(query, values);
    return res.rows.map(row => this.mapRowToRetrievedChunk(row));
  }

  async searchFullText(
    queryText: string, 
    workspaceId: string, 
    activeDocumentIds: string[] | undefined, 
    limit: number
  ): Promise<RetrievedChunk[]> {
    const activeDocsFilter = activeDocumentIds && activeDocumentIds.length > 0 
      ? 'AND document_id = ANY($3)' 
      : '';

    // plainto_tsquery stems user text and connects them with & (AND).
    // We convert & to | (OR) to allow matching if ANY search term is present, and rank by match density.
    const query = `
      SELECT id, document_id, document_name, section_path, chunk_index, content, metadata,
             ts_rank_cd(to_tsvector('english', content), query) AS score
      FROM document_chunks, to_tsquery('english', coalesce(nullif(replace(plainto_tsquery('english', $1)::text, '&', '|'), ''), 'dummy')) query
      WHERE workspace_id = $2 
        AND to_tsvector('english', content) @@ query
        ${activeDocsFilter}
      ORDER BY score DESC
      LIMIT ${limit};
    `;
    const values = [
      queryText,
      workspaceId,
      ...(activeDocumentIds && activeDocumentIds.length > 0 ? [activeDocumentIds] : [])
    ];

    const res = await this.db.query(query, values);
    return res.rows.map(row => this.mapRowToRetrievedChunk(row));
  }

  private mapRowToRetrievedChunk(row: any): RetrievedChunk {
    return {
      id: row.id,
      documentId: row.document_id,
      documentName: row.document_name,
      sectionPath: row.section_path || [],
      chunkIndex: row.chunk_index,
      content: row.content,
      score: row.score !== undefined ? parseFloat(row.score) : undefined,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    };
  }
}
