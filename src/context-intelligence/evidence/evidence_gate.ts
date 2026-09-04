import { ContextPlan, EvidencePack, EvidenceDecision } from '../types';

export interface EvidenceGateEvaluation {
  decision: EvidenceDecision;
  explanation: string;
  groundedMessage?: string;
  allowExecution: boolean;
}

export class EvidenceGate {
  /**
   * Evaluates EvidencePack against ContextPlan to decide next runtime action.
   */
  evaluate(plan: ContextPlan, pack: EvidencePack): EvidenceGateEvaluation {
    // 1. Check if clarification was flagged during state/routing resolution
    if (plan.fallback.strategy === 'ask_clarification' || (plan.routing.ambiguityDetected && plan.entities.length === 0 && plan.sources.database)) {
      return {
        decision: 'ASK_CLARIFICATION',
        explanation: 'User request contains ambiguous pronouns or unclear context reference without resolvable entities.',
        groundedMessage: plan.fallback.message || "Could you please clarify what specific order, item, or request you are referring to?",
        allowExecution: false
      };
    }

    // 2. Check for action capability requiring confirmation
    if (plan.execution.mode === 'write' && plan.execution.requiresConfirmation) {
      return {
        decision: 'REQUIRE_ACTION_CONFIRMATION',
        explanation: `Write capability action "${plan.execution.capability}" requires user confirmation before execution.`,
        allowExecution: false
      };
    }

    // 3. Operational query requirement check: DB operational questions MUST have valid DB evidence
    if (plan.sources.database) {
      const hasDbEvidence = pack.evidence.some(e => e.source === 'database');
      const hasDbRecords = pack.evidence.some(e => e.source === 'database' && e.type === 'record');

      if (!hasDbEvidence) {
        return {
          decision: 'SAFE_RESPONSE',
          explanation: 'Operational question requires live database evidence, but database retrieval was unavailable.',
          groundedMessage: "I checked our database system, but the requested records are currently unavailable. I cannot provide operational details without live database confirmation.",
          allowExecution: false
        };
      }

      // If an explicit entity search (like ORD-10001) was requested but 0 records were returned
      const hasOrderEntity = plan.entities.some(e => e.type === 'order_id');
      if (hasOrderEntity && !hasDbRecords) {
        const orderId = plan.entities.find(e => e.type === 'order_id')?.value;
        return {
          decision: 'SAFE_RESPONSE',
          explanation: `Order ${orderId} was queried in the database, but no record was found. Preventing operational hallucination.`,
          groundedMessage: `I searched our live system for order ${orderId}, but no matching record was found. Please double-check the order number.`,
          allowExecution: false
        };
      }
    }

    // 4. Check for knowledge queries without document evidence
    if (plan.sources.documents && pack.evidence.filter(e => e.source === 'document').length === 0) {
      if (!plan.sources.session && !plan.sources.database) {
        return {
          decision: 'SAFE_RESPONSE',
          explanation: 'Knowledge query produced no relevant matching documents.',
          groundedMessage: "I searched our documentation, but couldn't find specific information matching your question.",
          allowExecution: true
        };
      }
    }

    // 5. Default ALLOW_RESPONSE when evidence is sufficient
    return {
      decision: 'ALLOW_RESPONSE',
      explanation: 'Evidence is sufficient, relevant, and grounded. Proceeding to LLM response generation.',
      allowExecution: true
    };
  }
}

export const evidenceGate = new EvidenceGate();
