import { GoogleGenAI } from '@google/genai';
import { ContextEntity } from './types';
import dotenv from 'dotenv';

dotenv.config();

export interface LLMRouterOutput {
  intent: string;
  sources: {
    session: boolean;
    documents: boolean;
    database: boolean;
    capabilities: boolean;
  };
  entities: Array<{ type: string; value: string }>;
  operation: 'none' | 'read' | 'write';
  capability?: string;
  confidence: number;
  reasoning?: string;
}

export class IntentClassifier {
  private ai: GoogleGenAI | null = null;

  private getGenAI(): GoogleGenAI {
    if (!this.ai) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not configured in environment.');
      this.ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });
    }
    return this.ai;
  }

  /**
   * Invokes Gemini Flash (temperature=0) to classify ambiguous or multi-step requests.
   */
  async classify(
    userMessage: string,
    resolvedMessage: string,
    existingEntities: ContextEntity[]
  ): Promise<LLMRouterOutput> {
    try {
      const ai = this.getGenAI();

      const prompt = `You are an expert context router for an AI assistant platform.
Your task is to analyze the user's input and determine EXACTLY which information sources and capabilities are needed to handle the request.

User Input: "${userMessage}"
Resolved Context Input: "${resolvedMessage}"
Active Known Entities: ${JSON.stringify(existingEntities.map(e => ({ type: e.type, value: e.value })))}

Available Sources:
- session: needed if query refers to conversation history, past turns, or pronouns.
- documents: needed if query asks for static knowledge, policies, FAQs, manuals, refund rules, guidelines.
- database: needed if query asks for live operational records, order status, account balances, inventory, tickets.
- capabilities: needed if user requests an action/write operation (e.g. cancel order, update address).

Analyze carefully and return ONLY valid JSON matching this schema:
{
  "intent": "string (e.g. order_status, refund_policy, cancel_order, general_chat, unknown)",
  "sources": {
    "session": boolean,
    "documents": boolean,
    "database": boolean,
    "capabilities": boolean
  },
  "entities": [
    { "type": "string", "value": "string" }
  ],
  "operation": "none" | "read" | "write",
  "capability": "string or null",
  "confidence": number (0.0 to 1.0),
  "reasoning": "short explanation"
}`;

      const res = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: prompt,
        config: {
          temperature: 0,
          responseMimeType: 'application/json'
        }
      });

      const jsonText = res.text?.trim() || '{}';
      const parsed = JSON.parse(jsonText);

      // Validate output schema strictly
      return {
        intent: typeof parsed.intent === 'string' ? parsed.intent : 'general_chat',
        sources: {
          session: Boolean(parsed.sources?.session),
          documents: Boolean(parsed.sources?.documents),
          database: Boolean(parsed.sources?.database),
          capabilities: Boolean(parsed.sources?.capabilities),
        },
        entities: Array.isArray(parsed.entities) 
          ? parsed.entities.filter((e: any) => e && typeof e.type === 'string' && typeof e.value === 'string')
          : [],
        operation: ['none', 'read', 'write'].includes(parsed.operation) ? parsed.operation : 'none',
        capability: typeof parsed.capability === 'string' ? parsed.capability : undefined,
        confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.70,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined
      };
    } catch (err) {
      console.warn('[IntentClassifier] LLM router classification failed, returning safe default fallback:', err);
      return {
        intent: 'unknown',
        sources: { session: true, documents: true, database: true, capabilities: false },
        entities: [],
        operation: 'none',
        confidence: 0.50,
        reasoning: 'LLM router fallback error'
      };
    }
  }
}

export const intentClassifier = new IntentClassifier();
