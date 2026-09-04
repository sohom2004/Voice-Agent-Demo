import { DatabaseAgent, type ExecutionResult } from '../src';

// Groq (and OpenAI) expect this shape, not the {name, description, input_schema}
// shape getToolSchemas() returns — that one's Anthropic-flavored.
function toGroqTools(schemas: ReturnType<DatabaseAgent['getToolSchemas']>) {
  return schemas.map((s) => ({
    type: 'function' as const,
    function: { name: s.name, description: s.description, parameters: s.input_schema },
  }));
}

/**
 * One of these per active tenant. Cache it — syncManifest() is cheap to re-call
 * (no-op if schema hash unchanged) but there's no reason to hold a connection
 * per call; keep the agent alive across a session or the whole process.
 */
const tenantAgents = new Map<string, DatabaseAgent>();

async function getAgentForTenant(tenantId: string): Promise<DatabaseAgent> {
  let agent = tenantAgents.get(tenantId);
  if (!agent) {
    agent = new DatabaseAgent(await loadConnectionConfigFor(tenantId)); // pull from your credential vault
    await agent.syncManifest();
    tenantAgents.set(tenantId, agent);
  }
  return agent;
}

/**
 * Called from Natasha's cognitive controller when Groq's response includes a
 * tool_calls entry whose name matches one of this tenant's compiled tools.
 */
async function handleDbToolCall(
  tenantId: string,
  toolName: string,
  argsJson: string,
  opts: { confirmed?: boolean } = {}
): Promise<{ speak: string; result: ExecutionResult }> {
  const agent = await getAgentForTenant(tenantId);
  const params = JSON.parse(argsJson);
  const result = await agent.callTool(toolName, params, opts);

  switch (result.status) {
    case 'ok':
      return { speak: summarizeForVoice(result), result };

    case 'confirmation_required':
      // Don't auto-apply. Surface the pending change and let the caller confirm
      // verbally; the next turn re-calls this same function with confirmed: true.
      return { speak: `Just to confirm — you'd like me to ${result.pendingChange}. Shall I go ahead?`, result };

    case 'not_found':
      // This is exactly the trigger point for the slow-path fallback (not built yet).
      // Until then, degrade gracefully rather than failing silently.
      return { speak: `I'm not able to look that up automatically yet — let me get someone to help.`, result };

    case 'error':
      return { speak: `I hit an issue accessing that — could you try rephrasing?`, result };
  }
}

function summarizeForVoice(result: ExecutionResult): string {
  // Keep this deliberately simple — real formatting logic depends on the tool/table.
  return result.data ? `Here's what I found: ${JSON.stringify(result.data)}` : 'No matching record was found.';
}

async function loadConnectionConfigFor(tenantId: string): Promise<import('../src').ConnectionConfig> {
  throw new Error(`TODO: wire to your credential vault for tenant ${tenantId}`);
}

export { toGroqTools, getAgentForTenant, handleDbToolCall };
