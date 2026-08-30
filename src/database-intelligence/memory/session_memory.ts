export interface SessionContext {
  customerContext: Record<string, any>;
  entities: Record<string, any>;
  recentDatabaseResults: Array<{
    type: string;
    timestamp: number;
    data: any;
  }>;
}

export class SessionMemory {
  private sessions = new Map<string, { context: SessionContext; expiresAt: number }>();
  private defaultTtlMs = 15 * 60 * 1000; // 15 minutes session TTL

  /**
   * Retrieves or initializes a session context.
   */
  getOrCreateSession(sessionId: string): SessionContext {
    const now = Date.now();
    const existing = this.sessions.get(sessionId);

    if (existing && existing.expiresAt > now) {
      // Extend expiration
      existing.expiresAt = now + this.defaultTtlMs;
      return existing.context;
    }

    // Initialize new session
    const newContext: SessionContext = {
      customerContext: {},
      entities: {},
      recentDatabaseResults: []
    };

    this.sessions.set(sessionId, {
      context: newContext,
      expiresAt: now + this.defaultTtlMs
    });

    return newContext;
  }

  /**
   * Updates customer-specific identifiers in session memory.
   */
  setCustomerContext(sessionId: string, context: Record<string, any>): void {
    const sess = this.getOrCreateSession(sessionId);
    sess.customerContext = { ...sess.customerContext, ...context };
  }

  /**
   * Remembers an entity ID (e.g. order_id, ticket_id) discussed in conversation.
   */
  setEntity(sessionId: string, key: string, value: any): void {
    const sess = this.getOrCreateSession(sessionId);
    sess.entities[key] = value;
  }

  /**
   * Adds a database lookup result to recent results memory.
   */
  addRecentResult(sessionId: string, type: string, data: any): void {
    const sess = this.getOrCreateSession(sessionId);
    sess.recentDatabaseResults.push({
      type,
      timestamp: Date.now(),
      data
    });
    
    // Keep only last 5 query results to prevent memory bloat
    if (sess.recentDatabaseResults.length > 5) {
      sess.recentDatabaseResults.shift();
    }
  }

  /**
   * Resolves pronouns by searching recent database results for entities.
   */
  resolveEntityReference(sessionId: string, key: string): any {
    const sess = this.getOrCreateSession(sessionId);
    
    // First, check explicit entities
    if (sess.entities[key] !== undefined) {
      return sess.entities[key];
    }

    // Otherwise look at recent query results for a matching key (e.g. order_id or tracking_number)
    for (let i = sess.recentDatabaseResults.length - 1; i >= 0; i--) {
      const result = sess.recentDatabaseResults[i];
      if (Array.isArray(result.data)) {
        for (const item of result.data) {
          if (item && item[key] !== undefined) {
            return item[key];
          }
        }
      } else if (result.data && result.data[key] !== undefined) {
        return result.data[key];
      }
    }

    return null;
  }

  /**
   * Cleans up expired sessions.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [sid, item] of this.sessions.entries()) {
      if (item.expiresAt <= now) {
        this.sessions.delete(sid);
      }
    }
  }
}

// Export a single global instance for simplicity
export const sessionMemory = new SessionMemory();
