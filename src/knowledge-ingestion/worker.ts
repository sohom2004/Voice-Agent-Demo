import fs from 'fs';
import path from 'path';
import { PgDocumentRepository, PgChunkRepository } from '../storage/pgRepository';
import { DocumentParserRouter } from './parsers';
import { DocumentChunker } from './chunker';
import { EmbeddingProvider } from './embeddingProvider';
import { setupDatabase } from '../storage/dbSetup';

export class IngestionWorker {
  private docRepo: PgDocumentRepository;
  private chunkRepo: PgChunkRepository;
  private parserRouter: DocumentParserRouter;
  private chunker: DocumentChunker;
  private embedProvider: EmbeddingProvider;
  private isRunning = false;

  constructor() {
    this.docRepo = new PgDocumentRepository();
    this.chunkRepo = new PgChunkRepository();
    this.parserRouter = new DocumentParserRouter();
    this.chunker = new DocumentChunker();
    this.embedProvider = new EmbeddingProvider();
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Ensure database setup has run
    await setupDatabase();

    console.log('[Ingestion Worker] Ingestion loop started. Polling database for unprocessed uploads...');

    while (this.isRunning) {
      try {
        const jobs = await this.docRepo.getUnprocessed();
        if (jobs.length > 0) {
          console.log(`[Ingestion Worker] Found ${jobs.length} documents to process.`);
          for (const doc of jobs) {
            await this.processDocument(doc.id);
          }
        }
      } catch (err) {
        console.error('[Ingestion Worker] Error in ingestion polling loop:', err);
      }
      
      // Wait for 1 second before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  public stop(): void {
    this.isRunning = false;
    console.log('[Ingestion Worker] Worker loop stopped.');
  }

  private async processDocument(docId: string): Promise<void> {
    const doc = await this.docRepo.get(docId);
    if (!doc) return;

    console.log(`[Ingestion Worker] [${doc.name}] Starting processing...`);
    await this.docRepo.updateStatus(docId, 'processing');

    try {
      // 1. Read file buffer
      if (!fs.existsSync(doc.storagePath)) {
        throw new Error(`File not found at storage path: ${doc.storagePath}`);
      }
      const buffer = await fs.promises.readFile(doc.storagePath);

      // 2. Parse document to Canonical Representation
      console.log(`[Ingestion Worker] [${doc.name}] Parsing file...`);
      const canonicalDoc = await this.parserRouter.parse(doc.storagePath, buffer, doc.name);
      canonicalDoc.documentId = doc.id;
      canonicalDoc.workspaceId = doc.workspaceId;

      // 3. Perform structure-aware chunking
      console.log(`[Ingestion Worker] [${doc.name}] Chunking document sections...`);
      const chunks = this.chunker.chunk(canonicalDoc);
      console.log(`[Ingestion Worker] [${doc.name}] Generated ${chunks.length} chunks.`);

      // 4. Generate batch embeddings
      console.log(`[Ingestion Worker] [${doc.name}] Generating embeddings for chunks...`);
      const chunkTexts = chunks.map(c => {
        // Prepend section path to chunk content for better context grounding during search
        const pathPrefix = c.sectionPath.length > 0 
          ? `[Context Path: ${c.sectionPath.join(' > ')}]\n` 
          : '';
        return pathPrefix + c.content;
      });

      const embeddings = await this.embedProvider.embedBatch(chunkTexts);

      // 5. Delete any existing chunks for this document (safety overwrite)
      await this.chunkRepo.deleteByDocumentId(docId);

      // 6. Write chunks & embeddings to postgres
      console.log(`[Ingestion Worker] [${doc.name}] Indexing into PostgreSQL...`);
      await this.chunkRepo.createBatch(chunks, embeddings);

      // 7. Mark document status as ready
      await this.docRepo.updateStatus(docId, 'ready');
      console.log(`[Ingestion Worker] [${doc.name}] Processed successfully!`);

    } catch (err: any) {
      console.error(`[Ingestion Worker] [${doc.name}] Ingestion failed:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.docRepo.updateStatus(docId, 'failed', errMsg);
    }
  }
}
