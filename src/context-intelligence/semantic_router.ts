import { SemanticRouteResult } from './types';
import { EmbeddingProvider } from '../knowledge-ingestion/embeddingProvider';

interface RouteDefinition {
  name: string;
  description: string;
  sampleQueries: string[];
  embedding?: number[];
}

export class SemanticRouter {
  private embedProvider: EmbeddingProvider;
  private routes: RouteDefinition[];
  private initialized = false;

  constructor() {
    this.embedProvider = new EmbeddingProvider();
    this.routes = [
      {
        name: 'GENERAL_CONVERSATION',
        description: 'Chitchat, greetings, pleasantries, non-informational turns',
        sampleQueries: ['Hello', 'Hi there', 'Thank you so much', 'Good morning', 'Who are you']
      },
      {
        name: 'SESSION_CONTEXT',
        description: 'Questions relying on recent conversation context, history, or previous turns',
        sampleQueries: ['What did I ask earlier?', 'Can you repeat that?', 'What was my previous request?']
      },
      {
        name: 'DOCUMENT_KNOWLEDGE',
        description: 'Static knowledge base, documentation, policies, FAQs, manuals',
        sampleQueries: ['What is your refund policy?', 'How do I reset my account?', 'What are the warranty terms?', 'How does product X work?']
      },
      {
        name: 'LIVE_DATABASE',
        description: 'Live operational customer data, order status, account balances, ticket updates',
        sampleQueries: ['Where is my order?', 'What is my account balance?', 'Has my payment gone through?', 'What is the status of ticket #123?']
      },
      {
        name: 'CAPABILITY_ACTION',
        description: 'Requests to perform actions, modify records, or trigger business operations',
        sampleQueries: ['Cancel my order', 'Update my shipping address', 'Reset my password', 'Create a support ticket']
      },
      {
        name: 'MULTI_SOURCE',
        description: 'Complex queries needing both document rules and live database operational checks',
        sampleQueries: ['Can I cancel my order?', 'Is my order eligible for a refund under policy?', 'How do I return this order?']
      }
    ];
  }

  /**
   * Computes dot product between two normalized vectors.
   */
  private dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Initializes route embeddings lazily.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      const allSampleTexts: string[] = [];
      const routeMap: number[] = [];

      this.routes.forEach((r, routeIdx) => {
        r.sampleQueries.forEach(q => {
          allSampleTexts.push(q);
          routeMap.push(routeIdx);
        });
      });

      const sampleEmbeddings = await this.embedProvider.embedBatch(allSampleTexts);

      // Average sample embeddings for each route
      this.routes.forEach((route, idx) => {
        const indices = routeMap.reduce((acc, rIdx, i) => rIdx === idx ? [...acc, i] : acc, [] as number[]);
        if (indices.length > 0) {
          const dim = sampleEmbeddings[0].length;
          const avgVec = new Array(dim).fill(0);
          indices.forEach(i => {
            const vec = sampleEmbeddings[i];
            for (let d = 0; d < dim; d++) avgVec[d] += vec[d];
          });
          // Normalize average vector
          let norm = Math.sqrt(avgVec.reduce((sum, v) => sum + v * v, 0));
          if (!norm) norm = 1;
          route.embedding = avgVec.map(v => v / norm);
        }
      });

      this.initialized = true;
    } catch (err) {
      console.warn('[SemanticRouter] Failed to initialize embeddings. Will fallback gracefully:', err);
    }
  }

  /**
   * Classifies user message against pre-embedded routes using vector similarity.
   */
  async classify(userMessage: string): Promise<SemanticRouteResult> {
    await this.ensureInitialized();

    if (!this.initialized) {
      return {
        routes: [{ route: 'GENERAL_CONVERSATION', score: 0.5 }]
      };
    }

    try {
      const messageEmbedding = await this.embedProvider.embed(userMessage);

      const routeScores = this.routes.map(r => {
        let score = 0;
        if (r.embedding) {
          score = this.dotProduct(messageEmbedding, r.embedding);
        }
        return {
          route: r.name,
          score: Math.max(0, parseFloat(score.toFixed(4)))
        };
      });

      routeScores.sort((a, b) => b.score - a.score);

      return { routes: routeScores };
    } catch (err) {
      console.error('[SemanticRouter] Classification failed:', err);
      return {
        routes: [{ route: 'GENERAL_CONVERSATION', score: 0.5 }]
      };
    }
  }
}

export const semanticRouter = new SemanticRouter();
