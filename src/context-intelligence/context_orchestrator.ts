import { 
  ContextRequest, 
  ContextPlan, 
  ContextIntelligenceConfig, 
  DEFAULT_CONFIG 
} from './types';
import { entityResolver } from './entity_resolver';
import { ruleEngine } from './rule_engine';
import { semanticRouter } from './semantic_router';
import { confidenceEngine } from './confidence_engine';
import { intentClassifier } from './intent_classifier';
import { capabilityRegistry } from './capabilities';
import { ContextPlanBuilder } from './context_plan';

export class ContextOrchestrator {
  private config: ContextIntelligenceConfig;

  constructor(config: ContextIntelligenceConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  /**
   * Main Entrypoint: Resolves context, runs routing cascade, and builds ContextPlan.
   */
  async buildContext(request: ContextRequest): Promise<ContextPlan> {
    const startTime = Date.now();

    // 1. Resolve conversation state and entities
    const entityResult = entityResolver.resolve(
      request.userMessage,
      request.sessionId,
      request.conversationHistory
    );

    const { entities, resolvedMessage, pronounResolved } = entityResult;

    // 2. Stage 2: Run Deterministic Rule Engine
    const ruleSignals = ruleEngine.evaluate(request.userMessage, entities);

    let selectedSources = {
      session: ruleSignals.sessionScore > 0.3,
      documents: ruleSignals.documentScore >= 0.5,
      database: ruleSignals.databaseScore >= 0.5,
      capabilities: ruleSignals.capabilityScore >= 0.5,
      externalApis: [] as string[]
    };

    let routingStrategy: 'rules' | 'semantic' | 'llm' | 'hybrid' = 'rules';
    let semanticResult: any = undefined;
    let llmOutput: any = undefined;
    const allReasons: string[] = [...ruleSignals.reasons];

    const maxRuleScore = Math.max(
      ruleSignals.sessionScore,
      ruleSignals.documentScore,
      ruleSignals.databaseScore,
      ruleSignals.capabilityScore
    );

    // 3. Stage 3: Semantic Router (run if rule engine is not single high-confidence rule)
    if (maxRuleScore < this.config.ruleHighConfidence || pronounResolved) {
      semanticResult = await semanticRouter.classify(resolvedMessage);
      routingStrategy = 'semantic';
      
      const topRoute = semanticResult.routes[0];
      if (topRoute) {
        allReasons.push(`Semantic router evaluated top route: ${topRoute.route} (${topRoute.score})`);
        if (topRoute.route === 'DOCUMENT_KNOWLEDGE') {
          selectedSources.documents = true;
        } else if (topRoute.route === 'LIVE_DATABASE') {
          selectedSources.database = true;
        } else if (topRoute.route === 'MULTI_SOURCE') {
          selectedSources.documents = true;
          selectedSources.database = true;
          selectedSources.capabilities = true;
        } else if (topRoute.route === 'CAPABILITY_ACTION') {
          selectedSources.database = true;
          selectedSources.capabilities = true;
        }
      }
    }

    // 4. Assess Confidence & Ambiguity
    let confidenceAssessment = confidenceEngine.assess(
      request.userMessage,
      ruleSignals,
      semanticResult,
      entities
    );

    // 5. Stage 4: LLM Router for Ambiguous or Low Confidence requests
    if (
      confidenceAssessment.overallConfidence < this.config.lowConfidenceThreshold ||
      confidenceAssessment.ambiguityDetected
    ) {
      // If unmapped pronoun without any entity, trigger clarification directly
      const hasUnmappedPronoun = /\b(it|that|this)\b/i.test(request.userMessage) && 
        !entities.some(e => ['order_id', 'ticket_id', 'invoice_id', 'customer_id'].includes(e.type));

      if (hasUnmappedPronoun) {
        allReasons.push('Triggering clarification fallback: unmapped pronoun without entity context');
      } else {
        allReasons.push('Low confidence or ambiguity detected. Invoking LLM router classifier...');
        llmOutput = await intentClassifier.classify(
          request.userMessage,
          resolvedMessage,
          entities
        );
        routingStrategy = 'llm';

        selectedSources.session = selectedSources.session || llmOutput.sources.session;
        selectedSources.documents = selectedSources.documents || llmOutput.sources.documents;
        selectedSources.database = selectedSources.database || llmOutput.sources.database;
        selectedSources.capabilities = selectedSources.capabilities || llmOutput.sources.capabilities;

        confidenceAssessment = confidenceEngine.assess(
          request.userMessage,
          ruleSignals,
          semanticResult,
          entities,
          llmOutput.confidence
        );
      }
    }

    // 6. Capabilities matching
    let matchedCapabilityName: string | undefined;
    if (selectedSources.capabilities) {
      const matchedCaps = capabilityRegistry.findMatchingCapabilities(resolvedMessage);
      if (matchedCaps.length > 0) {
        matchedCapabilityName = matchedCaps[0].name;
        allReasons.push(`Matched explicit capability: ${matchedCapabilityName}`);
      }
    }

    // 7. Check for unmapped ambiguous request fallback
    const hasUnmappedPronoun = /\b(it|that|this)\b/i.test(request.userMessage) && 
      !entities.some(e => ['order_id', 'ticket_id', 'invoice_id', 'customer_id'].includes(e.type));

    const fallbackStrategy = hasUnmappedPronoun ? 'ask_clarification' : 'safe_response';
    const fallbackMessage = hasUnmappedPronoun
      ? "Could you clarify what specific item or request you are referring to?"
      : undefined;

    // 8. Build final ContextPlan
    const plan: ContextPlan = {
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
      userMessage: request.userMessage,
      resolvedMessage,
      intent: {
        primary: llmOutput?.intent || confidenceAssessment.topSource,
        confidence: confidenceAssessment.overallConfidence
      },
      sources: selectedSources,
      entities,
      retrieval: {
        documentQuery: selectedSources.documents ? resolvedMessage : undefined,
        databaseConcepts: selectedSources.database ? [resolvedMessage] : undefined,
        maxDocuments: 5,
        maxDatabaseTables: 5
      },
      execution: {
        mode: selectedSources.capabilities ? (matchedCapabilityName ? 'write' : 'read') : (selectedSources.database ? 'read' : 'none'),
        capability: matchedCapabilityName,
        requiresConfirmation: matchedCapabilityName ? (capabilityRegistry.getCapability(matchedCapabilityName)?.confirmationRequired ?? true) : false
      },
      routing: {
        strategy: routingStrategy,
        confidence: confidenceAssessment.overallConfidence,
        ambiguityDetected: confidenceAssessment.ambiguityDetected || hasUnmappedPronoun,
        reasons: allReasons
      },
      fallback: {
        strategy: fallbackStrategy,
        message: fallbackMessage
      }
    };

    console.log(`[ContextOrchestrator] Built ContextPlan in ${Date.now() - startTime}ms. Strategy: ${plan.routing.strategy}, Confidence: ${plan.routing.confidence}, Sources:`, plan.sources);

    return ContextPlanBuilder.validate(plan);
  }
}

export const contextOrchestrator = new ContextOrchestrator();
