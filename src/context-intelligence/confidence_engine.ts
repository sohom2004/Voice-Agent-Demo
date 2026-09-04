import { RoutingSignals, SemanticRouteResult, ContextEntity } from './types';

export interface ConfidenceAssessment {
  overallConfidence: number;
  ambiguityDetected: boolean;
  topSource: string;
  sourceConfidenceMap: Record<string, number>;
  reasons: string[];
}

export class ConfidenceEngine {
  assess(
    userMessage: string,
    signals: RoutingSignals,
    semanticResult?: SemanticRouteResult,
    entities: ContextEntity[] = [],
    llmConfidence?: number
  ): ConfidenceAssessment {
    const reasons: string[] = [];
    const sourceConfidenceMap: Record<string, number> = {
      session: signals.sessionScore,
      documents: signals.documentScore,
      database: signals.databaseScore,
      capabilities: signals.capabilityScore,
    };

    reasons.push(...signals.reasons);

    // 1. Incorporate Semantic Router signals if present
    if (semanticResult && semanticResult.routes.length > 0) {
      const topRoute = semanticResult.routes[0];
      reasons.push(`Semantic router top match: ${topRoute.route} (score: ${topRoute.score})`);

      if (topRoute.route === 'DOCUMENT_KNOWLEDGE') {
        sourceConfidenceMap.documents = Math.max(sourceConfidenceMap.documents, topRoute.score);
      } else if (topRoute.route === 'LIVE_DATABASE') {
        sourceConfidenceMap.database = Math.max(sourceConfidenceMap.database, topRoute.score);
      } else if (topRoute.route === 'CAPABILITY_ACTION') {
        sourceConfidenceMap.capabilities = Math.max(sourceConfidenceMap.capabilities, topRoute.score);
        sourceConfidenceMap.database = Math.max(sourceConfidenceMap.database, topRoute.score * 0.8);
      } else if (topRoute.route === 'MULTI_SOURCE') {
        sourceConfidenceMap.documents = Math.max(sourceConfidenceMap.documents, topRoute.score * 0.85);
        sourceConfidenceMap.database = Math.max(sourceConfidenceMap.database, topRoute.score * 0.85);
        sourceConfidenceMap.capabilities = Math.max(sourceConfidenceMap.capabilities, topRoute.score * 0.70);
      } else if (topRoute.route === 'GENERAL_CONVERSATION') {
        sourceConfidenceMap.session = Math.max(sourceConfidenceMap.session, topRoute.score);
      }
    }

    // 2. Deterministic confidence adjustments based on entities
    const hasResolvedRef = entities.some(e => e.source === 'resolved_reference');
    const hasCurrentMsgEntity = entities.some(e => e.source === 'current_message');

    if (hasCurrentMsgEntity) {
      sourceConfidenceMap.database = Math.min(1.0, sourceConfidenceMap.database + 0.15);
      reasons.push('Confidence boosted: explicit entity mentioned in current message');
    }

    if (hasResolvedRef) {
      sourceConfidenceMap.session = Math.min(1.0, sourceConfidenceMap.session + 0.20);
      reasons.push('Confidence boosted: pronoun reference successfully resolved via session memory');
    }

    // 3. Detect ambiguous pronouns without resolved entities
    const unmappedPronoun = /\b(it|that|this)\b/i.test(userMessage) && !hasResolvedRef && !hasCurrentMsgEntity;
    let ambiguityDetected = false;

    if (unmappedPronoun) {
      ambiguityDetected = true;
      reasons.push('Ambiguity penalty: unmapped pronoun without resolvable entity in session memory');
    }

    // 4. Check gap between top source scores to detect ambiguity
    const sortedSources = Object.entries(sourceConfidenceMap).sort((a, b) => b[1] - a[1]);
    const topVal = sortedSources[0][1];
    const secondVal = sortedSources[1][1];

    if (topVal > 0 && (topVal - secondVal) < 0.10 && topVal < 0.85) {
      ambiguityDetected = true;
      reasons.push(`Ambiguity detected: narrow score gap (${(topVal - secondVal).toFixed(2)}) between top candidates ${sortedSources[0][0]} and ${sortedSources[1][0]}`);
    }

    // 5. Calculate overall confidence
    let overallConfidence = topVal;
    if (llmConfidence !== undefined) {
      // Weight deterministic signals + LLM confidence
      overallConfidence = Math.min(1.0, (overallConfidence * 0.6) + (llmConfidence * 0.4));
    }

    if (ambiguityDetected) {
      overallConfidence *= 0.70;
    }

    return {
      overallConfidence: parseFloat(overallConfidence.toFixed(4)),
      ambiguityDetected,
      topSource: sortedSources[0][0],
      sourceConfidenceMap,
      reasons
    };
  }
}

export const confidenceEngine = new ConfidenceEngine();
