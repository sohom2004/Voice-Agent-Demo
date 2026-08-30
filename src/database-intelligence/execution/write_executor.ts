import { IntelRepository } from '../storage/intelRepository';
import { getConnector } from '../discovery/schema_inspector';
import { QueryFilter } from './query_planner';
import { sessionMemory } from '../memory/session_memory';

export interface WritePlan {
  capabilityName: string;
  operation: 'UPDATE' | 'INSERT';
  table: string;
  values: Record<string, any>;
  filters?: QueryFilter[];
}

export class WriteExecutor {
  private intelRepo = new IntelRepository();

  private blockedTablePatterns = [
    /user/i, /admin/i, /credential/i, /password/i, /session/i, /auth/i, /token/i, /secret/i, /key/i
  ];

  private blockedColumnTerms = [
    'password', 'pass_hash', 'salt', 'secret', 'token', 'api_key', 'cvv', 'credit_card', 'ssn', 'aadhaar'
  ];

  /**
   * Executes a controlled database update/insert plan inside a transaction after security validations.
   */
  async execute(
    workspaceId: string,
    connectionId: string,
    plan: WritePlan,
    sessionId?: string,
    timeoutMs = 5000
  ): Promise<{ affectedRows: number; success: boolean }> {
    // 1. Tenant/Workspace Scope Verification
    const connection = await this.intelRepo.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Database connection ${connectionId} not found.`);
    }
    if (connection.workspaceId !== workspaceId) {
      throw new Error('Tenant isolation breach attempt. Database connection belongs to a different workspace.');
    }

    // 2. Security checks on table and values keys
    if (this.blockedTablePatterns.some(pattern => pattern.test(plan.table))) {
      throw new Error(`Write access to table "${plan.table}" is blocked for security reasons.`);
    }

    for (const key of Object.keys(plan.values)) {
      if (this.blockedColumnTerms.some(term => key.toLowerCase().includes(term))) {
        throw new Error(`Write access to column "${key}" is blocked for security reasons.`);
      }
    }

    // 3. Resolve session placeholders in filters
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

      const colName = filter.column.includes('.') ? filter.column.split('.')[1] : filter.column;
      if (this.blockedColumnTerms.some(term => colName.toLowerCase().includes(term))) {
        throw new Error(`Filtering by column "${colName}" is blocked for security reasons.`);
      }

      return {
        ...filter,
        value: resolvedValue
      };
    }) : [];

    // 4. Resolve session placeholders in values
    const resolvedValues: Record<string, any> = {};
    for (const [key, val] of Object.entries(plan.values)) {
      let resolvedValue = val;
      if (typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}')) {
        const placeholderKey = val.slice(2, -2).trim();
        if (!sessionId) {
          throw new Error(`Session placeholder "${val}" cannot be resolved without a valid sessionId.`);
        }
        const sessionValue = sessionMemory.resolveEntityReference(sessionId, placeholderKey);
        if (sessionValue === null || sessionValue === undefined) {
          throw new Error(`Context variable "${placeholderKey}" is missing in session memory.`);
        }
        resolvedValue = sessionValue;
      }
      resolvedValues[key] = resolvedValue;
    }

    // 5. Compile parameter SQL statement
    const isPostgres = connection.provider === 'postgres';
    const wrap = (name: string): string => isPostgres ? `"${name}"` : `\`${name}\``;

    const sqlParams: any[] = [];
    let paramIndex = 1;
    const addParam = (val: any): string => {
      sqlParams.push(val);
      return isPostgres ? `$${paramIndex++}` : '?';
    };

    let sql = '';
    if (plan.operation === 'INSERT') {
      const columns = Object.keys(resolvedValues).map(k => wrap(k)).join(', ');
      const placeholders = Object.values(resolvedValues).map(v => addParam(v)).join(', ');
      sql = `INSERT INTO ${wrap(plan.table)} (${columns}) VALUES (${placeholders})`;
    } else if (plan.operation === 'UPDATE') {
      const setClauses = Object.entries(resolvedValues).map(([k, v]) => {
        return `${wrap(k)} = ${addParam(v)}`;
      }).join(', ');
      
      sql = `UPDATE ${wrap(plan.table)} SET ${setClauses}`;
      
      if (resolvedFilters.length > 0) {
        const filterClauses = resolvedFilters.map(filter => {
          const col = wrap(filter.column.includes('.') ? filter.column.split('.')[1] : filter.column);
          const op = filter.operator.toUpperCase();
          
          if (op === 'IN') {
            if (!Array.isArray(filter.value)) {
              throw new Error(`Filter operator IN requires an array value for column ${filter.column}`);
            }
            if (filter.value.length === 0) return '1=0';
            const placeholders = filter.value.map(val => addParam(val)).join(', ');
            return `${col} IN (${placeholders})`;
          }
          
          const placeholder = addParam(filter.value);
          return `${col} ${filter.operator} ${placeholder}`;
        });
        sql += ` WHERE ${filterClauses.join(' AND ')}`;
      } else {
        throw new Error('Unsafe UPDATE operation blocked: UPDATE query must specify at least one filter criterion.');
      }
    } else {
      throw new Error(`Unsupported write operation type: ${plan.operation}`);
    }

    // 6. Execute within a connection transaction
    const connector = getConnector(connection.provider, connection.connectionConfig);
    try {
      await connector.connect();
      const res = await connector.executeWrite(sql, sqlParams, timeoutMs);
      return { affectedRows: res.affectedRows, success: true };
    } finally {
      await connector.disconnect();
    }
  }
}
