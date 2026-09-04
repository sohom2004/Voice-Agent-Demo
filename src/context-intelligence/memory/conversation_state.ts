import { ContextEntity } from '../types';
import { entityMemory } from './entity_memory';

export interface ActiveConversationState {
  sessionId: string;
  activeEntities: ContextEntity[];
  recentIntents: string[];
  lastUserMessage?: string;
  lastAssistantMessage?: string;
}

export class ConversationStateResolver {
  /**
   * Resolves active conversation state including session entities and conversation history signals.
   */
  resolveState(
    sessionId: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): ActiveConversationState {
    const activeEntities = entityMemory.getActiveEntities(sessionId);
    const recentIntents: string[] = [];

    let lastUserMessage: string | undefined;
    let lastAssistantMessage: string | undefined;

    if (history && history.length > 0) {
      for (let i = history.length - 1; i >= 0; i--) {
        const item = history[i];
        if (item.role === 'user' && !lastUserMessage) {
          lastUserMessage = item.content;
        }
        if (item.role === 'assistant' && !lastAssistantMessage) {
          lastAssistantMessage = item.content;
        }
        if (lastUserMessage && lastAssistantMessage) break;
      }
    }

    return {
      sessionId,
      activeEntities,
      recentIntents,
      lastUserMessage,
      lastAssistantMessage
    };
  }
}

export const conversationStateResolver = new ConversationStateResolver();
