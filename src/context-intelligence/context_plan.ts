import { ContextPlan, ContextRequest, ContextEntity } from './types';

export class ContextPlanBuilder {
  static createDefaultPlan(request: ContextRequest): ContextPlan {
    return {
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      userMessage: request.userMessage,
      resolvedMessage: request.userMessage,
      intent: {
        primary: 'general_chat',
        confidence: 0.5
      },
      sources: {
        session: true,
        documents: false,
        database: false,
        capabilities: false,
        externalApis: []
      },
      entities: [],
      retrieval: {
        maxDocuments: 5,
        maxDatabaseTables: 5
      },
      execution: {
        mode: 'none',
        requiresConfirmation: false
      },
      routing: {
        strategy: 'rules',
        confidence: 0.5,
        ambiguityDetected: false,
        reasons: []
      },
      fallback: {
        strategy: 'safe_response'
      }
    };
  }

  static validate(plan: ContextPlan): ContextPlan {
    if (!plan.requestId) throw new Error('ContextPlan missing requestId');
    if (!plan.workspaceId) throw new Error('ContextPlan missing workspaceId');
    if (!plan.sessionId) throw new Error('ContextPlan missing sessionId');
    if (!plan.userMessage) throw new Error('ContextPlan missing userMessage');
    
    return plan;
  }
}
