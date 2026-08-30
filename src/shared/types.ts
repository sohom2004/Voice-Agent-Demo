export type DocumentStatus = 'uploaded' | 'processing' | 'ready' | 'failed';

export interface DocumentRecord {
  id: string;
  workspaceId: string;
  name: string;
  fileType: string;
  storagePath: string;
  status: DocumentStatus;
  error?: string;
  size: number;
  uploadedAt: number; // Unix timestamp
  createdAt: Date;
  updatedAt: Date;
}

export type SectionType = 'section' | 'paragraph' | 'table' | 'list' | 'code' | 'other';

export interface DocumentSection {
  id: string;
  title?: string;
  type: SectionType;
  content?: string;
  children?: DocumentSection[];
  source?: {
    page?: number;
    sheet?: string;
    row?: number;
  };
}

export interface CanonicalDocument {
  documentId: string;
  workspaceId: string;
  name: string;
  fileType: string;
  sections: DocumentSection[];
  metadata: Record<string, unknown>;
}

export interface DocumentChunk {
  id: string;
  workspaceId: string;
  documentId: string;
  documentName: string;
  sectionPath: string[]; // Heading hierarchies, e.g. ["Section A", "Subsection B"]
  chunkIndex: number;
  content: string;
  metadata: {
    page?: number;
    sheet?: string;
    sourceType?: string;
    [key: string]: unknown;
  };
}

export interface RetrievalRequest {
  query: string;
  workspaceId: string;
  activeDocumentIds?: string[];
  limit?: number;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  sectionPath: string[];
  chunkIndex: number;
  content: string;
  score?: number; // RRF Score or similarity
  metadata: Record<string, unknown>;
}

export interface SourceReference {
  documentId: string;
  documentName: string;
}

export interface RetrievalMetrics {
  embeddingMs: number;
  vectorSearchMs: number;
  fullTextSearchMs: number;
  fusionMs: number;
  contextAssemblyMs: number;
  totalMs: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  confidence?: number;
  sources: SourceReference[];
  metrics: RetrievalMetrics;
}

export interface KnowledgeAnalysis {
  summary: string;
  suggestedQuestions: string[];
}
