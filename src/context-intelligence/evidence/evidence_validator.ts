import { ContextPlan, EvidencePack } from '../types';

export class EvidenceValidator {
  /**
   * Validates if the EvidencePack meets the requirements specified in ContextPlan.
   */
  validate(plan: ContextPlan, pack: EvidencePack): {
    valid: boolean;
    missingSources: string[];
    reasons: string[];
  } {
    const missingSources: string[] = [];
    const reasons: string[] = [];

    // 1. Check required sources specified in ContextPlan
    if (plan.sources.database && !pack.sourcesUsed.includes('database')) {
      missingSources.push('database');
      reasons.push('Operational query requires database evidence, but no database evidence was retrieved.');
    }

    if (plan.sources.documents && !pack.sourcesUsed.includes('document')) {
      missingSources.push('document');
      reasons.push('Knowledge query requires document evidence, but no document evidence was retrieved.');
    }

    // 2. Check for empty evidence set
    if (pack.evidence.length === 0) {
      if (plan.sources.database || plan.sources.documents) {
        reasons.push('Retrieval returned zero evidence for required context sources.');
      }
    }

    const valid = missingSources.length === 0;

    return {
      valid,
      missingSources,
      reasons
    };
  }
}

export const evidenceValidator = new EvidenceValidator();
