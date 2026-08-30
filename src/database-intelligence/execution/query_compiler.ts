import { QueryPlan } from './query_planner';

export interface CompiledQuery {
  sql: string;
  params: any[];
}

export class QueryCompiler {
  /**
   * Compiles a QueryPlan JSON into parameterized SQL based on database provider syntax ('postgres' or 'mysql').
   */
  compile(plan: QueryPlan, provider: 'postgres' | 'mysql'): CompiledQuery {
    const isPostgres = provider.toLowerCase() === 'postgres' || provider.toLowerCase() === 'postgresql';
    
    // Identifier wrapper: double quotes for Postgres, backticks for MySQL
    const wrap = (name: string): string => {
      if (name === '*') return '*';
      
      // If name contains a period (e.g. table.column), wrap components separately
      if (name.includes('.')) {
        const parts = name.split('.');
        return parts.map(p => isPostgres ? `"${p}"` : `\`${p}\``).join('.');
      }
      
      return isPostgres ? `"${name}"` : `\`${name}\``;
    };

    const params: any[] = [];
    let paramIndex = 1;

    // Helper to push value and return correct query placeholder ($1 or ?)
    const addParam = (val: any): string => {
      params.push(val);
      if (isPostgres) {
        return `$${paramIndex++}`;
      } else {
        return '?';
      }
    };

    // 1. SELECT fields
    const selectFields = plan.fields.length > 0
      ? plan.fields.map(f => wrap(f)).join(', ')
      : '*';

    let sql = `SELECT ${selectFields} FROM ${wrap(plan.tables[0])}`;

    // 2. JOINS
    if (plan.joins && plan.joins.length > 0) {
      plan.joins.forEach(join => {
        sql += ` JOIN ${wrap(join.rightTable)} ON ${wrap(join.leftTable + '.' + join.leftColumn)} = ${wrap(join.rightTable + '.' + join.rightColumn)}`;
      });
    }

    // 3. FILTERS (WHERE clause)
    if (plan.filters && plan.filters.length > 0) {
      const filterClauses = plan.filters.map(filter => {
        const col = wrap(filter.column);
        const op = filter.operator.toUpperCase();
        
        if (op === 'IN') {
          if (!Array.isArray(filter.value)) {
            throw new Error(`Filter operator IN requires an array value for column ${filter.column}`);
          }
          if (filter.value.length === 0) {
            return '1=0'; // Empty IN clause always matches nothing
          }
          const placeholders = filter.value.map(val => addParam(val)).join(', ');
          return `${col} IN (${placeholders})`;
        }

        // Standard comparison operations
        const placeholder = addParam(filter.value);
        return `${col} ${filter.operator} ${placeholder}`;
      });

      sql += ` WHERE ${filterClauses.join(' AND ')}`;
    }

    // 4. ORDER BY
    if (plan.orderBy) {
      const dir = plan.orderBy.direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${wrap(plan.orderBy.column)} ${dir}`;
    }

    // 5. LIMIT
    if (plan.limit !== undefined) {
      sql += ` LIMIT ${plan.limit}`;
    }

    return { sql, params };
  }
}
