import { ContextPlan } from './types';
import { HybridRetrievalService, ContextBuilder as DocContextBuilder } from '../retrieval/retrievalService';
import { IntelRepository } from '../database-intelligence/storage/intelRepository';
import { LexicalRetriever } from '../database-intelligence/retrieval/lexical_retriever';
import { SemanticRetriever } from '../database-intelligence/retrieval/semantic_retriever';
import { RelationshipExpander } from '../database-intelligence/retrieval/relationship_expander';
import { ContextBuilder as DbContextBuilder } from '../database-intelligence/retrieval/context_builder';
import { ReadExecutor } from '../database-intelligence/execution/read_executor';
import { QueryCompiler } from '../database-intelligence/execution/query_compiler';
import { sessionMemory } from '../database-intelligence/memory/session_memory';

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
  private intelRepo: IntelRepository;
  private lexicalRetriever: LexicalRetriever;
  private semanticRetriever: SemanticRetriever;
  private relationshipExpander: RelationshipExpander;
  private dbContextBuilder: DbContextBuilder;
  private docContextBuilder: DocContextBuilder;
  private readExecutor: ReadExecutor;
  private queryCompiler: QueryCompiler;

  constructor() {
    this.retrievalService = new HybridRetrievalService();
    this.intelRepo = new IntelRepository();
    this.lexicalRetriever = new LexicalRetriever();
    this.semanticRetriever = new SemanticRetriever();
    this.relationshipExpander = new RelationshipExpander();
    this.dbContextBuilder = new DbContextBuilder();
    this.docContextBuilder = new DocContextBuilder();
    this.readExecutor = new ReadExecutor();
    this.queryCompiler = new QueryCompiler();
  }

  /**
   * Executes parallel retrieval tasks based on ContextPlan sources.
   */
  async execute(
    plan: ContextPlan,
    activeDocumentIds?: string[]
  ): Promise<RawRetrievalResults> {
    const totalStart = Date.now();
    let docStart = 0;
    let dbStart = 0;

    let docChunks: any[] = [];
    let docContextString = '';
    let dbContextXml = '';
    let dbRows: any[] = [];
    let activeConnection: any = null;
    let sessionContextData: any = null;

    let docLatency = 0;
    let dbLatency = 0;

    // 1. Document RAG Task
    const docPromise = (async () => {
      if (!plan.sources.documents) return;
      docStart = Date.now();
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
        docLatency = Date.now() - (docStart || Date.now());
      }
    })();

    // 2. Database Intelligence Task
    const dbPromise = (async () => {
      if (!plan.sources.database) return;
      dbStart = Date.now();
      try {
        const dbConnections = await this.intelRepo.listConnections(plan.workspaceId);
        activeConnection = dbConnections.find(c => c.status === 'ready') || null;

        if (activeConnection) {
          const query = plan.resolvedMessage;
          const lexicalMatches = await this.lexicalRetriever.retrieve(activeConnection.id, query);
          const semanticMatches = await this.semanticRetriever.retrieveTables(activeConnection.id, query, 0.20);

          const tableScores = new Map<string, number>();
          lexicalMatches.forEach(m => tableScores.set(m.tableName, (tableScores.get(m.tableName) || 0) + m.matchScore));
          semanticMatches.forEach(m => tableScores.set(m.tableName, (tableScores.get(m.tableName) || 0) + m.similarity * 3.0));

          const sortedTables = Array.from(tableScores.entries())
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0]);

          let targetTableNames = sortedTables.slice(0, plan.retrieval.maxDatabaseTables || 5);
          if (targetTableNames.length === 0) {
            const allTables = await this.intelRepo.getTablesMetadata(activeConnection.id);
            const userTables = allTables.filter(t => 
              !t.name.startsWith('db_') && t.name !== 'documents' && t.name !== 'document_chunks'
            );
            targetTableNames = userTables.slice(0, 5).map(t => t.name);
          }

          const semanticCaps = await this.semanticRetriever.retrieveCapabilities(activeConnection.id, query, 0.20);
          const expansion = await this.relationshipExpander.expand(activeConnection.id, targetTableNames);

          dbContextXml = await this.dbContextBuilder.buildContext(
            activeConnection.id,
            expansion.expandedTables,
            expansion.relationships,
            semanticCaps
          );

          // Direct database execution if explicit entity is present (e.g. order_id = ORD-10001)
          const orderEntity = plan.entities.find(e => e.type === 'order_id');
          if (orderEntity && targetTableNames.length > 0) {
            try {
              const primaryTable = targetTableNames.find(t => t.includes('order')) || targetTableNames[0];
              const queryPlan = {
                operation: 'SELECT' as const,
                tables: [primaryTable],
                fields: [`${primaryTable}.*`],
                filters: [
                  { column: 'order_id', operator: '=' as const, value: orderEntity.value }
                ],
                limit: 5
              };
              const compiled = this.queryCompiler.compile(queryPlan, activeConnection.provider);
              dbRows = await this.readExecutor.execute(activeConnection.id, compiled);
            } catch (queryErr) {
              // Try fallback column 'id' if 'order_id' column fails
              try {
                const primaryTable = targetTableNames.find(t => t.includes('order')) || targetTableNames[0];
                const queryPlan = {
                  operation: 'SELECT' as const,
                  tables: [primaryTable],
                  fields: [`${primaryTable}.*`],
                  filters: [
                    { column: 'id', operator: '=' as const, value: orderEntity.value }
                  ],
                  limit: 5
                };
                const compiled = this.queryCompiler.compile(queryPlan, activeConnection.provider);
                dbRows = await this.readExecutor.execute(activeConnection.id, compiled);
                
                // #oogabooga
                if (dbRows.length > 0) {
                  console.log('[RetrievalExecutor #oogabooga] Fetched Columns:', Object.keys(dbRows[0]));
                  console.log('[RetrievalExecutor #oogabooga] Data Read:', JSON.stringify(dbRows, null, 2));
                }
              } catch (fallbackErr) {
                console.warn('[RetrievalExecutor] Automatic entity DB query failed:', fallbackErr);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[RetrievalExecutor] Database retrieval failed:', err);
      } finally {
        dbLatency = Date.now() - (dbStart || Date.now());
      }
    })();

    // 3. Session Context Task
    const sessionPromise = (async () => {
      if (!plan.sources.session) return;
      try {
        sessionContextData = sessionMemory.getOrCreateSession(plan.sessionId);
      } catch (err) {
        console.warn('[RetrievalExecutor] Session memory retrieval failed:', err);
      }
    })();

    // Execute independent tasks in parallel
    await Promise.all([docPromise, dbPromise, sessionPromise]);

    const totalMs = Date.now() - totalStart;

    return {
      docChunks,
      docContextString,
      dbContextXml,
      dbRows,
      activeConnection,
      sessionContextData,
      latencies: {
        documentsMs: docLatency,
        databaseMs: dbLatency,
        totalMs
      }
    };
  }
}

export const retrievalExecutor = new RetrievalExecutor();
