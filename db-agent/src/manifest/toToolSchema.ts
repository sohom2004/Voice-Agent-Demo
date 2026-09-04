import type { ToolManifest, ToolParamSpec } from '../types';

export interface LLMToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

/**
 * Converts a compiled manifest into Anthropic/OpenAI-style tool definitions,
 * ready to hand to the orchestrator's function-calling call. This is the whole
 * point of the fast path: the agent sees a small, fixed set of these — not the
 * tenant's raw schema.
 */
export function manifestToToolSchemas(manifest: ToolManifest): LLMToolSchema[] {
  return manifest.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        tool.params.map((p: ToolParamSpec) => [
          p.name,
          { type: jsonSchemaType(p.columnType), description: p.isFilter ? 'filter value' : undefined },
        ])
      ),
      required: tool.params.filter((p) => p.required).map((p) => p.name),
    },
  }));
}

function jsonSchemaType(sqlType: string): string {
  const t = sqlType.toLowerCase();
  if (t.includes('int') || t.includes('numeric') || t.includes('decimal') || t.includes('float') || t.includes('double')) {
    return 'number';
  }
  if (t.includes('bool')) return 'boolean';
  return 'string';
}
