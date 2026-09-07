interface SessionState {
  entities: Record<string, string | number>;
  customerContext: Record<string, string | number>;
}

class SessionMemory {
  private sessions = new Map<string, SessionState>();

  getOrCreateSession(sessionId: string): SessionState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { entities: {}, customerContext: {} });
    }
    return this.sessions.get(sessionId)!;
  }

  setEntity(sessionId: string, key: string, value: string | number): void {
    const session = this.getOrCreateSession(sessionId);
    session.entities[key] = value;
  }
}

export const sessionMemory = new SessionMemory();
