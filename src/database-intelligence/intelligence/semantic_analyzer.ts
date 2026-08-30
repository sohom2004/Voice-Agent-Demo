import { GoogleGenAI } from '@google/genai';
import { TableMetadata } from '../connectors/base';
import { EmbeddingProvider } from '../../knowledge-ingestion/embeddingProvider';

// Helper to lazy initialize Gemini client
function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  return new GoogleGenAI({ apiKey });
}

export interface GeneratedTableSemantic {
  description: string;
  businessConcepts: string[];
  synonyms: string[];
}

export interface GeneratedCapability {
  name: string;
  type: 'READ' | 'WRITE';
  description: string;
  requiredContext: string[];
  relevantTables: string[];
  permissions: string[];
}

export class SemanticAnalyzer {
  private embedProvider = new EmbeddingProvider();

  /**
   * Analyzes a table's schema and a small row sample to generate human-like description, concepts, and synonyms.
   */
  async analyzeTable(table: TableMetadata, maskedSample: any[]): Promise<GeneratedTableSemantic> {
    const ai = getGenAI();
    
    const schemaDetails = table.columns.map(col => {
      return `- Column: ${col.name} (${col.dataType})${col.isPrimaryKey ? ' [PRIMARY KEY]' : ''}${col.isForeignKey ? ` [FOREIGN KEY REFERENCES ${col.foreignKeyReferences?.targetTable}.${col.foreignKeyReferences?.targetColumn}]` : ''}`;
    }).join('\n');

    const sampleRowsJson = JSON.stringify(maskedSample, null, 2);

    const prompt = `
You are a database intelligence agent. Analyze this database table structure and its data sample to extract its business meaning, core business concepts, and synonyms.

Table Name: ${table.name}
Schema: ${table.schemaName}
Row Count: ${table.rowCount || 0}

Columns:
${schemaDetails}

Sample Data Rows (Masked for Security):
${sampleRowsJson}

Respond ONLY with a valid JSON object matching the following structure. Do not include markdown code block formatting (like \`\`\`json) or any additional conversational text.

Structure:
{
  "description": "Short, natural-language description of what this table represents and stores.",
  "businessConcepts": ["list", "of", "4-6", "core", "business", "concepts", "or", "activities", "represented", "by", "this", "table"],
  "synonyms": ["list", "of", "5-8", "common", "synonyms", "or", "search", "terms", "for", "the", "table", "or", "what", "it", "represents"]
}
`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const text = response.text || '';
      // Clean JSON string in case the model added code blocks
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson) as GeneratedTableSemantic;
    } catch (err) {
      console.warn(`[Semantic Analyzer] Gemini failed for table ${table.name}. Using default metadata. Error:`, err);
      return {
        description: `Stores records for database table ${table.name}.`,
        businessConcepts: [table.name],
        synonyms: [table.name]
      };
    }
  }

  /**
   * Generates a list of logical capabilities (Read/Write workflows) for a set of discovered tables.
   */
  async generateCapabilities(tables: TableMetadata[]): Promise<GeneratedCapability[]> {
    const ai = getGenAI();

    const tableSummaries = tables.map(table => {
      const columnsList = table.columns.map(c => c.name).join(', ');
      return `- Table: ${table.name} (${columnsList})`;
    }).join('\n\n');

    const prompt = `
You are a database access planner. Analyze the following tables schema and suggest exactly 4 to 6 logical high-level database capabilities (READ and WRITE) that an AI voice support agent should execute to help customers.

Discovered Tables Schema:
${tableSummaries}

Respond ONLY with a valid JSON array of objects matching the following structure. Do not include markdown code block formatting (like \`\`\`json) or any additional conversational text.

Structure:
[
  {
    "name": "get_customer_orders",
    "type": "READ",
    "description": "Finds purchase orders for a customer by customer id or email.",
    "requiredContext": ["customer_id"],
    "relevantTables": ["orders"],
    "permissions": ["customer_support_read"]
  },
  {
    "name": "cancel_order",
    "type": "WRITE",
    "description": "Cancels a pending order and updates its status in the system.",
    "requiredContext": ["order_id"],
    "relevantTables": ["orders"],
    "permissions": ["customer_support_write"]
  }
]
`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const text = response.text || '';
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson) as GeneratedCapability[];
    } catch (err) {
      console.warn('[Semantic Analyzer] Gemini failed to generate capabilities. Returning empty list. Error:', err);
      return [];
    }
  }

  /**
   * Generates vector embeddings for a description string.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      return await this.embedProvider.embed(text);
    } catch (err) {
      console.warn('[Semantic Analyzer] Embedding generation failed:', err);
      return new Array(3072).fill(0); // Return empty zero vector on failure to prevent table insert crashes
    }
  }
}
