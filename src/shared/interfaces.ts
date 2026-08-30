import { 
  CanonicalDocument, 
  DocumentRecord, 
  DocumentChunk, 
  RetrievalRequest, 
  RetrievalResult,
  RetrievedChunk
} from './types';

export interface DocumentParser {
  supports(fileType: string): boolean;
  parse(filePath: string, buffer: Buffer, fileName: string): Promise<CanonicalDocument>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimension(): number;
}

export interface VectorSearchProvider {
  search(
    queryEmbedding: number[], 
    workspaceId: string, 
    activeDocumentIds: string[] | undefined, 
    limit: number
  ): Promise<RetrievedChunk[]>;
}

export interface FullTextSearchProvider {
  search(
    queryText: string, 
    workspaceId: string, 
    activeDocumentIds: string[] | undefined, 
    limit: number
  ): Promise<RetrievedChunk[]>;
}

export interface ContextBuilder {
  build(chunks: RetrievedChunk[]): string;
}

export interface RetrievalService {
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
}

export interface DocumentRepository {
  create(doc: Omit<DocumentRecord, 'createdAt' | 'updatedAt'>): Promise<DocumentRecord>;
  get(id: string): Promise<DocumentRecord | null>;
  list(workspaceId: string): Promise<DocumentRecord[]>;
  updateStatus(id: string, status: DocumentRecord['status'], error?: string): Promise<void>;
  delete(id: string): Promise<boolean>;
  getUnprocessed(): Promise<DocumentRecord[]>;
}

export interface ChunkRepository {
  createBatch(chunks: Omit<DocumentChunk, 'id'>[], embeddings: number[][]): Promise<void>;
  deleteByDocumentId(documentId: string): Promise<void>;
  searchVector(
    embedding: number[], 
    workspaceId: string, 
    activeDocumentIds: string[] | undefined, 
    limit: number,
    usePgVector: boolean
  ): Promise<RetrievedChunk[]>;
  searchFullText(
    query: string, 
    workspaceId: string, 
    activeDocumentIds: string[] | undefined, 
    limit: number
  ): Promise<RetrievedChunk[]>;
}
