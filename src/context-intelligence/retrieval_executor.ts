import { ContextPlan } from './types';
import { HybridRetrievalService, ContextBuilder as DocContextBuilder } from '../retrieval/retrievalService';

export interface RawRetrievalResults {
  docChunks: any[];
  docContextString: string;
  dbContextXml: string;
  dbRows: any[];
  activeConnection: any | null;
  sessionContextData: any;
  latencies: {
    documentsMs: number;
    databaseMs: number;
    totalMs: number;
  };
}

export class RetrievalExecutor {
  private retrievalService: HybridRetrievalService;
  private docContextBuilder: DocContextBuilder;

  constructor() {
    this.retrievalService = new HybridRetrievalService();
    this.docContextBuilder = new DocContextBuilder();
  }

  async execute(
    plan: ContextPlan,
    activeDocumentIds?: string[]
  ): Promise<RawRetrievalResults> {
    const totalStart = Date.now();
    let docChunks: any[] = [];
    let docContextString = '';
    let docLatency = 0;

    if (plan.sources.documents) {
      const docStart = Date.now();
      try {
        const query = plan.retrieval.documentQuery || plan.resolvedMessage;
        const res = await this.retrievalService.retrieve({
          query,
          workspaceId: plan.workspaceId,
          activeDocumentIds,
          limit: plan.retrieval.maxDocuments || 5
        });
        docChunks = res.chunks || [];
        docContextString = this.docContextBuilder.build(docChunks);
      } catch (err) {
        console.warn('[RetrievalExecutor] Document retrieval failed:', err);
      } finally {
        docLatency = Date.now() - docStart;
      }
    }

    return {
      docChunks,
      docContextString,
      dbContextXml: '',
      dbRows: [],
      activeConnection: null,
      sessionContextData: null,
      latencies: {
        documentsMs: docLatency,
        databaseMs: 0,
        totalMs: Date.now() - totalStart
      }
    };
  }
}

export const retrievalExecutor = new RetrievalExecutor();
