import { ContextEntity } from '../types';
import { sessionMemory } from '../../database-intelligence/memory/session_memory';

export class EntityMemory {
  /**
   * Retrieves active entities stored in session memory for a given session.
   */
  getActiveEntities(sessionId: string): ContextEntity[] {
    const session = sessionMemory.getOrCreateSession(sessionId);
    const result: ContextEntity[] = [];

    if (session.entities) {
      for (const [key, value] of Object.entries(session.entities)) {
        if (value !== undefined && value !== null) {
          result.push({
            type: key,
            value: String(value),
            confidence: 0.95,
            source: 'session_memory'
          });
        }
      }
    }

    if (session.customerContext) {
      for (const [key, value] of Object.entries(session.customerContext)) {
        if (value !== undefined && value !== null) {
          result.push({
            type: key,
            value: String(value),
            confidence: 0.90,
            source: 'session_memory'
          });
        }
      }
    }

    return result;
  }

  /**
   * Saves or updates an entity in session memory.
   */
  saveEntity(sessionId: string, key: string, value: string | number): void {
    sessionMemory.setEntity(sessionId, key, value);
  }
}

export const entityMemory = new EntityMemory();
