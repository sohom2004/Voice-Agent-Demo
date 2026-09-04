import { GoogleGenAI } from '@google/genai';
import { EmbeddingProvider as IEmbeddingProvider } from '../shared/interfaces';
import dotenv from 'dotenv';

dotenv.config();

export class EmbeddingProvider implements IEmbeddingProvider {
  private ai: GoogleGenAI;
  private modelName = 'gemini-embedding-2';
  private dimension = 768;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in the environment.');
    }
    this.ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  getDimension(): number {
    return this.dimension;
  }

  private normalizeVector(values: number[]): number[] {
    let vector = values;
    if (vector.length > this.dimension) {
      vector = vector.slice(0, this.dimension);
    }
    let sumSquares = 0;
    for (const v of vector) sumSquares += v * v;
    const norm = Math.sqrt(sumSquares);
    if (!norm || !Number.isFinite(norm)) return vector;
    return vector.map(v => v / norm);
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.ai.models.embedContent({
        model: this.modelName,
        contents: text,
        config: {
          outputDimensionality: this.dimension,
        },
      });

      if (response.embeddings && response.embeddings.length > 0) {
        return this.normalizeVector(response.embeddings[0].values);
      }
      throw new Error('No embedding returned from Gemini API.');
    } catch (err) {
      console.error('[EmbeddingProvider] Error embedding text:', err);
      throw err;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    
    try {
      const response = await this.ai.models.embedContent({
        model: this.modelName,
        contents: texts,
        config: {
          outputDimensionality: this.dimension,
        },
      });

      if (response.embeddings && response.embeddings.length === texts.length) {
        return response.embeddings.map(e => this.normalizeVector(e.values));
      }
      
      // Fallback: If it didn't return matches or failed batching, embed concurrently in batches of 5
      console.warn('[EmbeddingProvider] Batch embedding fallback to concurrent requests...');
      const results: number[][] = [];
      const batchSize = 5;
      
      for (let i = 0; i < texts.length; i += batchSize) {
        const batchTexts = texts.slice(i, i + batchSize);
        const batchPromises = batchTexts.map(t => this.embed(t));
        const batchEmbeds = await Promise.all(batchPromises);
        results.push(...batchEmbeds);
      }
      
      return results;
    } catch (err) {
      console.warn('[EmbeddingProvider] Batch embed failed, trying concurrent fallback...', err);
      // Concurrent fallback on failure
      const results: number[][] = [];
      const batchSize = 5;
      for (let i = 0; i < texts.length; i += batchSize) {
        const batchTexts = texts.slice(i, i + batchSize);
        const batchPromises = batchTexts.map(t => this.embed(t));
        const batchEmbeds = await Promise.all(batchPromises);
        results.push(...batchEmbeds);
      }
      return results;
    }
  }
}
