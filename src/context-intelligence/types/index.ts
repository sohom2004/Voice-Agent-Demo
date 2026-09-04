export interface ContextEntity {
  type: string;
  value: string;
  normalizedValue?: string;
  confidence: number;
  source: 'current_message' | 'session_memory' | 'conversation_history' | 'resolved_reference';
}

export interface RoutingSignals {
  sessionScore: number;
  documentScore: number;
  databaseScore: number;
  capabilityScore: number;
  externalApiScore: number;
  reasons: string[];
}

export interface SemanticRouteResult {
  routes: Array<{
    route: string;
    score: number;
  }>;
}

export interface ContextRequest {
  requestId: string;
  workspaceId: string;
  sessionId: string;
  userMessage: string;
  activeDocumentIds?: string[];
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ContextPlan {
  requestId: string;
  workspaceId: string;
  sessionId: string;
  userMessage: string;
  resolvedMessage: string;

  intent: {
    primary: string;
    secondary?: string[];
    confidence: number;
  };

  sources: {
    session: boolean;
    documents: boolean;
    database: boolean;
    capabilities: boolean;
    externalApis: string[];
  };

  entities: ContextEntity[];

  retrieval: {
    documentQuery?: string;
    documentFilters?: Record<string, unknown>;
    databaseConcepts?: string[];
    databaseTables?: string[];
    databaseEntities?: Record<string, any>;
    capabilityQueries?: string[];
    maxDocuments?: number;
    maxDatabaseTables?: number;
  };

  execution: {
    mode: 'none' | 'read' | 'write';
    capability?: string;
    requiresConfirmation: boolean;
  };

  routing: {
    strategy: 'rules' | 'semantic' | 'llm' | 'hybrid';
    confidence: number;
    ambiguityDetected: boolean;
    reasons?: string[];
  };

  fallback: {
    strategy: 'ask_clarification' | 'retry_retrieval' | 'safe_response' | 'handoff';
    message?: string;
  };
}

export interface Evidence {
  id: string;
  source: 'session' | 'document' | 'database' | 'capability' | 'external_api';
  type: 'fact' | 'policy' | 'schema' | 'record' | 'instruction';
  content: unknown;
  relevance: number;
  confidence: number;
  freshness?: {
    retrievedAt: Date;
    expiresAt?: Date;
  };
  provenance: {
    sourceId?: string;
    documentId?: string;
    table?: string;
    recordId?: string;
    details?: string;
  };
}

export interface EvidenceConflict {
  entityOrTopic: string;
  conflictingSources: string[];
  evidenceIds: string[];
  description: string;
  resolution?: string;
}

export interface EvidencePack {
  evidence: Evidence[];
  summary?: string;
  sourcesUsed: string[];
  confidence: number;
  conflicts: EvidenceConflict[];
  sufficient: boolean;
  missingRequiredSources?: string[];
}

export type EvidenceDecision =
  | 'ALLOW_RESPONSE'
  | 'RETRY_RETRIEVAL'
  | 'ASK_CLARIFICATION'
  | 'SAFE_RESPONSE'
  | 'REQUIRE_ACTION_CONFIRMATION';

export interface CapabilityInput {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  operation: 'read' | 'write';
  requiredInputs: CapabilityInput[];
  optionalInputs?: CapabilityInput[];
  requiredSources?: ('database' | 'documents' | 'external_api')[];
  permissions?: string[];
  confirmationRequired: boolean;
}

export interface SourceAuthorityRule {
  factCategory: string;
  preferredSources: string[];
  requiredSources?: string[];
}

export interface ContextIntelligenceConfig {
  ruleHighConfidence: number;
  semanticHighConfidence: number;
  ambiguityGap: number;
  lowConfidenceThreshold: number;
}

export const DEFAULT_CONFIG: ContextIntelligenceConfig = {
  ruleHighConfidence: 0.90,
  semanticHighConfidence: 0.85,
  ambiguityGap: 0.10,
  lowConfidenceThreshold: 0.65,
};
