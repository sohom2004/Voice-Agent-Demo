import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Connection config
const poolConfig = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'postgres',
};

export const pool = new Pool(poolConfig);

export async function setupDatabase(): Promise<{ usePgVector: boolean }> {
  const client = await pool.connect();
  try {
    console.log('[DB Setup] Checking database capabilities...');

    // 1. Check if pgvector is available
    const extCheck = await client.query(
      "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'"
    );
    const pgVectorAvailable = extCheck.rowCount > 0;
    let usePgVector = false;

    if (pgVectorAvailable) {
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
        console.log('[DB Setup] pgvector extension successfully enabled/verified.');
        usePgVector = true;
      } catch (err) {
        console.warn(
          '[DB Setup] pgvector was available but failed to enable. Falling back to SQL vector search. Error:',
          err
        );
      }
    } else {
      console.log('[DB Setup] pgvector extension is NOT available. Using SQL array fallback.');
    }

    // 2. Create documents table
    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(100) PRIMARY KEY,
        workspace_id VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        file_type VARCHAR(50) NOT NULL,
        storage_path VARCHAR(512) NOT NULL,
        status VARCHAR(50) NOT NULL,
        error TEXT,
        size INT NOT NULL,
        uploaded_at BIGINT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Index on workspace_id for documents
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id);
    `);

    // 3. Create document_chunks table
    if (usePgVector) {
      // Create table with vector column (dimension 768 for gemini-embedding-2 Matryoshka)
      await client.query(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          id VARCHAR(100) PRIMARY KEY,
          workspace_id VARCHAR(100) NOT NULL,
          document_id VARCHAR(100) REFERENCES documents(id) ON DELETE CASCADE,
          document_name VARCHAR(255) NOT NULL,
          section_path TEXT[] NOT NULL,
          chunk_index INT NOT NULL,
          content TEXT NOT NULL,
          metadata JSONB NOT NULL,
          embedding vector(768),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Ensure dimension is 768
      try {
        const typeCheck = await client.query(`
          SELECT format_type(a.atttypid, a.atttypmod) AS data_type
          FROM pg_attribute a
          WHERE a.attrelid = 'document_chunks'::regclass AND a.attname = 'embedding' AND a.attnum > 0;
        `);
        if (typeCheck.rows.length > 0 && typeCheck.rows[0].data_type !== 'vector(768)') {
          console.log(`[DB Setup] Migrating document_chunks.embedding from ${typeCheck.rows[0].data_type} to vector(768)...`);
          await client.query(`DROP INDEX IF EXISTS document_chunks_embedding_hnsw;`);
          await client.query(`ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(768) USING NULL;`);
        }
      } catch (e) {
        console.warn('[DB Setup] document_chunks dimension check notice:', e);
      }

      // HNSW index on embedding for ultra-fast vector search
      // Note: We use cosine distance operator (vector_cosine_ops)
      await client.query(`
        CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw 
        ON document_chunks 
        USING hnsw (embedding vector_cosine_ops);
      `);
    } else {
      // Fallback: Create table with real[] column
      await client.query(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          id VARCHAR(100) PRIMARY KEY,
          workspace_id VARCHAR(100) NOT NULL,
          document_id VARCHAR(100) REFERENCES documents(id) ON DELETE CASCADE,
          document_name VARCHAR(255) NOT NULL,
          section_path TEXT[] NOT NULL,
          chunk_index INT NOT NULL,
          content TEXT NOT NULL,
          metadata JSONB NOT NULL,
          embedding real[],
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // PL/pgSQL function for cosine similarity
      await client.query(`
        CREATE OR REPLACE FUNCTION cosine_similarity(a real[], b real[])
        RETURNS double precision AS $$
        DECLARE
            dot_product double precision := 0;
            norm_a double precision := 0;
            norm_b double precision := 0;
            i integer;
            len integer;
        BEGIN
            len := cardinality(a);
            IF len IS NULL OR len = 0 OR cardinality(b) IS NULL OR cardinality(b) <> len THEN
                RETURN 0;
            END IF;
            FOR i IN 1..len LOOP
                dot_product := dot_product + (a[i] * b[i]);
                norm_a := norm_a + (a[i] * a[i]);
                norm_b := norm_b + (b[i] * b[i]);
            END LOOP;
            IF norm_a = 0 OR norm_b = 0 THEN
                RETURN 0;
            END IF;
            RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;
      `);
    }

    // Indexes for workspace, documents, and chunk searching
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_workspace_doc ON document_chunks(workspace_id, document_id);
    `);

    // Full-Text Search Lexical Index using Gin on to_tsvector
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_content_fts 
      ON document_chunks 
      USING gin (to_tsvector('english', content));
    `);

    console.log('[DB Setup] Schema successfully initialized.');
    return { usePgVector };
  } finally {
    client.release();
  }
}
