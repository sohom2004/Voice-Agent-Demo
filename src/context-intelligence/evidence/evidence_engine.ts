import { ContextPlan, Evidence, EvidencePack } from '../types';
import { RawRetrievalResults } from '../retrieval_executor';
import { conflictResolver } from './conflict_resolver';
import { evidenceValidator } from './evidence_validator';

export class EvidenceEngine {
  /**
   * Transforms raw retrieval outputs into a normalized EvidencePack.
   */
  process(plan: ContextPlan, rawResults: RawRetrievalResults): EvidencePack {
    const rawEvidenceList: Evidence[] = [];
    const sourcesUsedSet = new Set<string>();

    // 1. Process Document Chunks into Evidence
    if (rawResults.docChunks && rawResults.docChunks.length > 0) {
      sourcesUsedSet.add('document');
      rawResults.docChunks.forEach((chunk, idx) => {
        rawEvidenceList.push({
          id: `doc_ev_${chunk.id || idx}`,
          source: 'document',
          type: 'policy',
          content: chunk.content,
          relevance: chunk.score || 0.70,
          confidence: plan.routing.confidence,
          freshness: { retrievedAt: new Date() },
          provenance: {
            sourceId: chunk.documentId,
            documentId: chunk.documentId,
            details: chunk.documentName
          }
        });
      });
    }

    // 2. Process Database Schema & Rows into Evidence
    if (rawResults.dbContextXml || (rawResults.dbRows && rawResults.dbRows.length > 0)) {
      sourcesUsedSet.add('database');

      if (rawResults.dbRows && rawResults.dbRows.length > 0) {
        rawResults.dbRows.forEach((row, idx) => {
          rawEvidenceList.push({
            id: `db_row_ev_${idx}`,
            source: 'database',
            type: 'record',
            content: row,
            relevance: 0.95,
            confidence: 0.95,
            freshness: { retrievedAt: new Date() },
            provenance: {
              table: plan.retrieval.databaseTables?.[0] || 'customer_db',
              recordId: row.id || row.order_id || row.customer_id ? String(row.id || row.order_id || row.customer_id) : undefined
            }
          });
        });
      }

      if (rawResults.dbContextXml) {
        rawEvidenceList.push({
          id: `db_schema_ev_0`,
          source: 'database',
          type: 'schema',
          content: rawResults.dbContextXml,
          relevance: 0.80,
          confidence: 0.90,
          freshness: { retrievedAt: new Date() },
          provenance: {
            details: 'Database Schema Context XML'
          }
        });
      }
    }

    // 3. Process Session Memory into Evidence
    if (rawResults.sessionContextData) {
      sourcesUsedSet.add('session');
      if (plan.entities.length > 0) {
        rawEvidenceList.push({
          id: `session_ev_0`,
          source: 'session',
          type: 'fact',
          content: plan.entities,
          relevance: 0.90,
          confidence: 0.90,
          freshness: { retrievedAt: new Date() },
          provenance: {
            details: 'Session Memory Active Entities'
          }
        });
      }
    }

    // 4. Resolve conflicts and filter evidence
    const { filteredEvidence, conflicts } = conflictResolver.resolveConflicts(rawEvidenceList);

    const sourcesUsed = Array.from(sourcesUsedSet);

    // 5. Construct preliminary EvidencePack
    const initialPack: EvidencePack = {
      evidence: filteredEvidence,
      sourcesUsed,
      confidence: filteredEvidence.length > 0 ? Math.max(...filteredEvidence.map(e => e.confidence)) : plan.routing.confidence,
      conflicts,
      sufficient: filteredEvidence.length > 0 || (!plan.sources.documents && !plan.sources.database)
    };

    // 6. Validate required source presence
    const validation = evidenceValidator.validate(plan, initialPack);
    if (!validation.valid) {
      initialPack.sufficient = false;
      initialPack.missingRequiredSources = validation.missingSources;
    }

    return initialPack;
  }
}

export const evidenceEngine = new EvidenceEngine();
