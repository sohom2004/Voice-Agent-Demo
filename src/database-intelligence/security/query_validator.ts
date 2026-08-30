import { QueryPlan } from '../execution/query_planner';
import { IntelRepository } from '../storage/intelRepository';
import { sessionMemory } from '../memory/session_memory';

export class QueryValidator {
  private intelRepo = new IntelRepository();

  // Blocklisted table names (regex matches)
  private blockedTablePatterns = [
    /user/i, /admin/i, /credential/i, /password/i, /session/i, /auth/i, /token/i, /secret/i, /key/i
  ];

  // Blocklisted column names (exact/partial matches)
  private blockedColumnTerms = [
    'password', 'pass_hash', 'salt', 'secret', 'token', 'api_key', 'cvv', 'credit_card', 'ssn', 'aadhaar'
  ];

  /**
   * Validates a query plan against tenant isolation, security restrictions, and blocklists.
   * Resolves any session-specific variable placeholders (e.g. {{customer_id}}) dynamically.
   */
  async validateAndResolve(
    workspaceId: string,
    connectionId: string,
    plan: QueryPlan,
    sessionId?: string
  ): Promise<QueryPlan> {
    // 1. Tenant/Workspace Isolation Check
    const connection = await this.intelRepo.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Database connection ${connectionId} not found.`);
    }
    if (connection.workspaceId !== workspaceId) {
      throw new Error('Tenant isolation breach attempt. Database connection belongs to a different workspace.');
    }

    // 2. Operation restriction
    if (plan.operation !== 'SELECT') {
      throw new Error(`Unsafe operation ${plan.operation} blocked. QueryValidator only permits SELECT reads.`);
    }

    // 3. Blocklist Table Check
    for (const tableName of plan.tables) {
      if (this.blockedTablePatterns.some(pattern => pattern.test(tableName))) {
        throw new Error(`Access to table "${tableName}" is blocked for security reasons.`);
      }
    }

    // 4. Blocklist Column Check
    for (const field of plan.fields) {
      const colName = field.includes('.') ? field.split('.')[1] : field;
      if (this.blockedColumnTerms.some(term => colName.toLowerCase().includes(term))) {
        throw new Error(`Access to column "${colName}" is blocked for security reasons.`);
      }
    }

    // 5. Enforce strict output limits
    const maxLimit = 50;
    const requestedLimit = plan.limit !== undefined ? plan.limit : 20;
    const finalLimit = Math.min(requestedLimit, maxLimit);

    // 6. Resolve session placeholders in filters
    const resolvedFilters = plan.filters ? plan.filters.map(filter => {
      let resolvedValue = filter.value;

      if (typeof filter.value === 'string' && filter.value.startsWith('{{') && filter.value.endsWith('}}')) {
        const placeholderKey = filter.value.slice(2, -2).trim();
        
        if (!sessionId) {
          throw new Error(`Session placeholder "${filter.value}" cannot be resolved without a valid sessionId.`);
        }

        const sessionValue = sessionMemory.resolveEntityReference(sessionId, placeholderKey);
        if (sessionValue === null || sessionValue === undefined) {
          throw new Error(`Context variable "${placeholderKey}" is missing in the current conversation session.`);
        }
        resolvedValue = sessionValue;
      }

      // Check if filter column name is sensitive
      const colName = filter.column.includes('.') ? filter.column.split('.')[1] : filter.column;
      if (this.blockedColumnTerms.some(term => colName.toLowerCase().includes(term))) {
        throw new Error(`Filtering by column "${colName}" is blocked for security reasons.`);
      }

      return {
        ...filter,
        value: resolvedValue
      };
    }) : [];

    return {
      ...plan,
      filters: resolvedFilters,
      limit: finalLimit
    };
  }
}
