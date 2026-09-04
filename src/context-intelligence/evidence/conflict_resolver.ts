import { Evidence, EvidenceConflict, SourceAuthorityRule } from '../types';

export class ConflictResolver {
  private authorityRules: SourceAuthorityRule[] = [
    {
      factCategory: 'operational_data',
      preferredSources: ['database', 'external_api'],
      requiredSources: ['database']
    },
    {
      factCategory: 'policy_and_rules',
      preferredSources: ['document'],
      requiredSources: ['document']
    },
    {
      factCategory: 'conversation_history',
      preferredSources: ['session'],
      requiredSources: ['session']
    }
  ];

  /**
   * Resolves conflicts between evidence from different sources.
   * Ensures operational data from database overrides document assumptions.
   */
  resolveConflicts(evidenceList: Evidence[]): {
    filteredEvidence: Evidence[];
    conflicts: EvidenceConflict[];
  } {
    const conflicts: EvidenceConflict[] = [];

    const dbEvidence = evidenceList.filter(e => e.source === 'database');
    const docEvidence = evidenceList.filter(e => e.source === 'document');

    // Check if there is conflict between DB record state and document policy assumptions
    if (dbEvidence.length > 0 && docEvidence.length > 0) {
      // Both DB and document evidence are present. Apply source authority: DB wins for operational status.
      conflicts.push({
        entityOrTopic: 'Operational Status vs Document Policy',
        conflictingSources: ['database', 'document'],
        evidenceIds: [...dbEvidence.map(e => e.id), ...docEvidence.map(e => e.id)],
        description: 'Live database evidence available. Grounding operational facts on live database records.',
        resolution: 'Prefer database evidence for live status; use document evidence for general terms.'
      });
    }

    // Filter and order evidence according to authority
    const filteredEvidence = [...evidenceList].sort((a, b) => {
      // DB evidence ranked higher for operational queries
      if (a.source === 'database' && b.source === 'document') return -1;
      if (a.source === 'document' && b.source === 'database') return 1;
      return b.relevance - a.relevance;
    });

    return {
      filteredEvidence,
      conflicts
    };
  }
}

export const conflictResolver = new ConflictResolver();
