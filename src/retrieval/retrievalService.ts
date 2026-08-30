import { 
  RetrievalService as IRetrievalService, 
  ContextBuilder as IContextBuilder 
} from '../shared/interfaces';
import { 
  RetrievalRequest, 
  RetrievalResult, 
  RetrievedChunk, 
  SourceReference,
  RetrievalMetrics
} from '../shared/types';
import { PgChunkRepository } from '../storage/pgRepository';
import { EmbeddingProvider } from '../knowledge-ingestion/embeddingProvider';
import { pool } from '../storage/dbSetup';

export class DefaultContextBuilder implements IContextBuilder {
  build(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) {
      return '';
    }

    let text = '--- RETRIEVED DOCUMENT KNOWLEDGE ---\n\n';
    
    // Group chunks by document to keep the final context clean and readable
    const docsMap = new Map<string, RetrievedChunk[]>();
    for (const chunk of chunks) {
      const list = docsMap.get(chunk.documentName) || [];
      list.push(chunk);
      docsMap.set(chunk.documentName, list);
    }

    for (const [docName, docChunks] of docsMap.entries()) {
      text += `[DOCUMENT: ${docName}]\n`;
      for (const chunk of docChunks) {
        if (chunk.sectionPath && chunk.sectionPath.length > 0) {
          text += `[SECTION: ${chunk.sectionPath.join(' > ')}]\n`;
        }
        text += `${chunk.content}\n`;
        text += `---\n`;
      }
      text += '\n';
    }

    text += '--- END RETRIEVED DOCUMENT KNOWLEDGE ---';
    return text.trim();
  }
}

export class HybridRetrievalService implements IRetrievalService {
  private chunkRepo: PgChunkRepository;
  private embedProvider: EmbeddingProvider;
  private contextBuilder: IContextBuilder;
  private usePgVector = false;
  private checkedCapabilities = false;

  constructor() {
    this.chunkRepo = new PgChunkRepository();
    this.embedProvider = new EmbeddingProvider();
    this.contextBuilder = new DefaultContextBuilder();
  }

  private async checkDbCapabilities() {
    if (this.checkedCapabilities) return;
    try {
      const client = await pool.connect();
      try {
        const extCheck = await client.query(
          "SELECT 1 FROM pg_extension WHERE extname = 'vector';"
        );
        this.usePgVector = extCheck.rowCount > 0;
        console.log(`[RetrievalService] DB capabilities check - pgvector available: ${this.usePgVector}`);
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn('[RetrievalService] Failed checking pgvector capabilities. Defaulting to SQL fallback search.', err);
      this.usePgVector = false;
    }
    this.checkedCapabilities = true;
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const totalStart = Date.now();
    const metrics: Partial<RetrievalMetrics> = {
      embeddingMs: 0,
      vectorSearchMs: 0,
      fullTextSearchMs: 0,
      fusionMs: 0,
      contextAssemblyMs: 0,
      totalMs: 0
    };

    const limit = request.limit || 5;

    // A. Check pgvector status on DB
    await this.checkDbCapabilities();

    // B. Generate Query Embedding
    const embedStart = Date.now();
    const queryEmbedding = await this.embedProvider.embed(request.query);
    metrics.embeddingMs = Date.now() - embedStart;

    // C. Execute Vector and Full-Text Searches concurrently
    const vecStart = Date.now();
    const ftsStart = Date.now();

    const vectorPromise = this.chunkRepo.searchVector(
      queryEmbedding, 
      request.workspaceId, 
      request.activeDocumentIds, 
      limit * 2, // Retrieve more candidates for better rank fusion
      this.usePgVector
    ).then(res => {
      metrics.vectorSearchMs = Date.now() - vecStart;
      return res;
    }).catch(err => {
      console.error('[RetrievalService] Vector search failed:', err);
      metrics.vectorSearchMs = Date.now() - vecStart;
      return [] as RetrievedChunk[];
    });

    const ftsPromise = this.chunkRepo.searchFullText(
      request.query, 
      request.workspaceId, 
      request.activeDocumentIds, 
      limit * 2
    ).then(res => {
      metrics.fullTextSearchMs = Date.now() - ftsStart;
      return res;
    }).catch(err => {
      console.error('[RetrievalService] Full-text search failed:', err);
      metrics.fullTextSearchMs = Date.now() - ftsStart;
      return [] as RetrievedChunk[];
    });

    const [vectorCandidates, ftsCandidates] = await Promise.all([vectorPromise, ftsPromise]);

    // D. Perform Reciprocal Rank Fusion (RRF)
    const fusionStart = Date.now();
    const k = 60; // Standard constant for RRF
    
    // Store scores and candidates by ID
    const mergedCandidates = new Map<string, { chunk: RetrievedChunk; score: number }>();

    // Add vector search candidates
    vectorCandidates.forEach((cand, idx) => {
      if (cand.score !== undefined && cand.score < 0.30) return; // Filter out low similarity noise
      const rank = idx + 1;
      const score = 1 / (k + rank);
      mergedCandidates.set(cand.id, { chunk: cand, score });
    });

    // Add/Merge FTS candidates
    ftsCandidates.forEach((cand, idx) => {
      const rank = idx + 1;
      const score = 1 / (k + rank);
      
      const existing = mergedCandidates.get(cand.id);
      if (existing) {
        existing.score += score; // Add scores for duplicate hits
      } else {
        mergedCandidates.set(cand.id, { chunk: cand, score });
      }
    });

    // Sort and slice top items
    const fusedChunks = Array.from(mergedCandidates.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => ({
        ...item.chunk,
        score: item.score
      }));

    metrics.fusionMs = Date.now() - fusionStart;

    // E. Assemble retrieved chunks into Context
    const assemblyStart = Date.now();
    const contextString = this.contextBuilder.build(fusedChunks);
    metrics.contextAssemblyMs = Date.now() - assemblyStart;

    // F. Construct final list of referenced sources
    const sourcesMap = new Map<string, string>();
    for (const chunk of fusedChunks) {
      sourcesMap.set(chunk.documentId, chunk.documentName);
    }
    const sources: SourceReference[] = Array.from(sourcesMap.entries()).map(([id, name]) => ({
      documentId: id,
      documentName: name
    }));

    metrics.totalMs = Date.now() - totalStart;

    // Print development latency benchmarking logs
    console.log(`\n[Retrieval Performance] Query: "${request.query}"`);
    console.log(`  Embedding:          ${metrics.embeddingMs}ms`);
    console.log(`  Vector Search:      ${metrics.vectorSearchMs}ms`);
    console.log(`  Full Text Search:   ${metrics.fullTextSearchMs}ms`);
    console.log(`  Rank Fusion:        ${metrics.fusionMs}ms`);
    console.log(`  Context Assembly:   ${metrics.contextAssemblyMs}ms`);
    console.log(`  Total Latency:      ${metrics.totalMs}ms\n`);

    return {
      chunks: fusedChunks,
      confidence: fusedChunks.length > 0 ? parseFloat(fusedChunks[0].score?.toFixed(4) || '0') : 0,
      sources,
      metrics: metrics as RetrievalMetrics
    };
  }
}
export { DefaultContextBuilder as ContextBuilder };
