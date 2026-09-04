import { ContextEntity } from './types';
import { conversationStateResolver } from './memory/conversation_state';

export interface EntityResolutionResult {
  entities: ContextEntity[];
  resolvedMessage: string;
  pronounResolved: boolean;
}

export class EntityResolver {
  private patterns: Array<{ type: string; regex: RegExp; confidence: number }> = [
    { type: 'order_id', regex: /\bORD-[A-Za-z0-9]+\b/gi, confidence: 0.99 },
    { type: 'invoice_id', regex: /\bINV-[A-Za-z0-9]+\b/gi, confidence: 0.99 },
    { type: 'customer_id', regex: /\bCUS-[A-Za-z0-9]+\b/gi, confidence: 0.99 },
    { type: 'ticket_id', regex: /\b(?:ticket\s*#?|#)(\d{3,8})\b/gi, confidence: 0.95 },
    { type: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, confidence: 0.98 },
    { type: 'generic_code', regex: /\b[A-Z]{2,4}-\d{3,8}\b/g, confidence: 0.90 }
  ];

  /**
   * Resolves entities explicitly in message, merges session entities, and resolves pronouns.
   */
  resolve(
    userMessage: string,
    sessionId: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): EntityResolutionResult {
    const extractedEntities: ContextEntity[] = [];

    // 1. Extract entities from current message
    for (const pat of this.patterns) {
      pat.regex.lastIndex = 0; // Reset regex state
      let match: RegExpExecArray | null;
      while ((match = pat.regex.exec(userMessage)) !== null) {
        const val = match[0].trim();
        // Avoid duplicate additions
        if (!extractedEntities.some(e => e.value.toLowerCase() === val.toLowerCase())) {
          extractedEntities.push({
            type: pat.type,
            value: val,
            normalizedValue: val.toUpperCase(),
            confidence: pat.confidence,
            source: 'current_message'
          });
        }
      }
    }

    // 2. Fetch active state from session memory
    const state = conversationStateResolver.resolveState(sessionId, history);
    const sessionEntities = state.activeEntities;

    // 3. Merge entities (current message overrides session memory for same type)
    const finalEntitiesMap = new Map<string, ContextEntity>();
    for (const se of sessionEntities) {
      finalEntitiesMap.set(se.type, se);
    }
    for (const ee of extractedEntities) {
      finalEntitiesMap.set(ee.type, ee);
    }

    // 4. Pronoun and reference resolution
    let resolvedMessage = userMessage;
    let pronounResolved = false;

    const pronounRegex = /\b(it|that|this|the order|that order|this order|the ticket|that ticket|the invoice)\b/i;
    if (pronounRegex.test(userMessage)) {
      // Check if we have active order_id or ticket_id or invoice_id
      const activeOrderId = finalEntitiesMap.get('order_id');
      const activeTicketId = finalEntitiesMap.get('ticket_id');
      const activeInvoiceId = finalEntitiesMap.get('invoice_id');

      if (activeOrderId && !userMessage.toUpperCase().includes(activeOrderId.value.toUpperCase())) {
        resolvedMessage = userMessage.replace(
          pronounRegex,
          `order ${activeOrderId.value}`
        );
        pronounResolved = true;
        finalEntitiesMap.set('order_id', {
          ...activeOrderId,
          source: 'resolved_reference',
          confidence: 0.95
        });
      } else if (activeTicketId && !userMessage.toUpperCase().includes(activeTicketId.value.toUpperCase())) {
        resolvedMessage = userMessage.replace(
          pronounRegex,
          `ticket ${activeTicketId.value}`
        );
        pronounResolved = true;
        finalEntitiesMap.set('ticket_id', {
          ...activeTicketId,
          source: 'resolved_reference',
          confidence: 0.95
        });
      } else if (activeInvoiceId && !userMessage.toUpperCase().includes(activeInvoiceId.value.toUpperCase())) {
        resolvedMessage = userMessage.replace(
          pronounRegex,
          `invoice ${activeInvoiceId.value}`
        );
        pronounResolved = true;
        finalEntitiesMap.set('invoice_id', {
          ...activeInvoiceId,
          source: 'resolved_reference',
          confidence: 0.95
        });
      }
    }

    const mergedEntities = Array.from(finalEntitiesMap.values());

    return {
      entities: mergedEntities,
      resolvedMessage,
      pronounResolved
    };
  }
}

export const entityResolver = new EntityResolver();
