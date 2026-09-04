import { RoutingSignals, ContextEntity } from './types';

export class RuleEngine {
  private greetingRegex = /^(hello|hi|hey|greetings|good morning|good afternoon|good evening|thanks|thank you|okay|ok|bye|goodbye|who are you|repeat that)\b[!.?]*$/i;
  
  private documentKeywords = [
    'policy', 'refund', 'warranty', 'terms', 'condition', 'manual', 
    'documentation', 'guide', 'how does', 'how to', 'rules', 'faq',
    'coverage', 'instructions', 'procedure', 'architecture', 'overview'
  ];

  private databaseKeywords = [
    'status', 'where is', 'when will', 'balance', 'remaining', 'available',
    'current', 'today', 'right now', 'latest', 'order', 'invoice', 'customer',
    'shipment', 'tracking', 'account', 'ticket', 'details', 'cancel', 'update',
    'payment', 'transaction', 'inventory', 'stock'
  ];

  private actionKeywords = [
    'cancel', 'update', 'modify', 'change', 'create', 'delete', 'reset',
    'book', 'schedule', 'send', 'pay', 'refund me'
  ];

  evaluate(message: string, entities: ContextEntity[]): RoutingSignals {
    const text = message.trim().toLowerCase();
    const reasons: string[] = [];

    let sessionScore = 0.50;
    let documentScore = 0.10;
    let databaseScore = 0.10;
    let capabilityScore = 0.10;
    let externalApiScore = 0.10;

    // 1. Pure Greeting / Conversational check
    if (this.greetingRegex.test(text)) {
      reasons.push('Matched pure conversational greeting rule');
      return {
        sessionScore: 0.98,
        documentScore: 0.00,
        databaseScore: 0.00,
        capabilityScore: 0.00,
        externalApiScore: 0.00,
        reasons
      };
    }

    // 2. Operational Identifier presence
    const hasOpId = entities.some(e => 
      ['order_id', 'invoice_id', 'customer_id', 'ticket_id'].includes(e.type)
    );
    if (hasOpId) {
      databaseScore += 0.50;
      sessionScore += 0.20;
      reasons.push('Explicit operational identifier present in resolved entities');
    }

    // 3. Document / Policy Keyword check
    const matchedDocKw = this.documentKeywords.filter(kw => text.includes(kw));
    if (matchedDocKw.length > 0) {
      const boost = Math.min(0.80, matchedDocKw.length * 0.35);
      documentScore += boost;
      reasons.push(`Matched document knowledge keywords: [${matchedDocKw.join(', ')}]`);
    }

    // 4. Operational / Database Keyword check
    const matchedDbKw = this.databaseKeywords.filter(kw => text.includes(kw));
    if (matchedDbKw.length > 0) {
      const boost = Math.min(0.70, matchedDbKw.length * 0.25);
      databaseScore += boost;
      reasons.push(`Matched operational database keywords: [${matchedDbKw.join(', ')}]`);
    }

    // 5. Capability / Action Keyword check
    const matchedActionKw = this.actionKeywords.filter(kw => text.includes(kw));
    if (matchedActionKw.length > 0) {
      capabilityScore += 0.50;
      reasons.push(`Matched capability action keywords: [${matchedActionKw.join(', ')}]`);

      // If user asks "Can I [action]..." or "How do I [action]...", it is a multi-source question checking both cancellation policy (docs) and eligibility (database)
      if (text.includes('can i') || text.includes('how do i') || text.includes('eligible') || text.includes('policy')) {
        documentScore += 0.50;
        databaseScore += 0.40;
        reasons.push('Multi-source pattern detected: policy question regarding action eligibility');
      }
    }

    // Normalize scores to [0, 1] range
    sessionScore = Math.min(1.0, Math.max(0.0, sessionScore));
    documentScore = Math.min(1.0, Math.max(0.0, documentScore));
    databaseScore = Math.min(1.0, Math.max(0.0, databaseScore));
    capabilityScore = Math.min(1.0, Math.max(0.0, capabilityScore));
    externalApiScore = Math.min(1.0, Math.max(0.0, externalApiScore));

    return {
      sessionScore,
      documentScore,
      databaseScore,
      capabilityScore,
      externalApiScore,
      reasons
    };
  }
}

export const ruleEngine = new RuleEngine();
