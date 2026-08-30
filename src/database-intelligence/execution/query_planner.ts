export interface QueryJoin {
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
}

export interface QueryFilter {
  column: string; // e.g. "orders.customer_id"
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'ILIKE' | 'IN';
  value: any; // Can be a string, number, array, or session placeholder (like "{{customer_id}}")
}

export interface QueryOrderBy {
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface QueryPlan {
  operation: 'SELECT';
  tables: string[];
  fields: string[]; // e.g. ["orders.status", "shipments.tracking_number"]
  joins?: QueryJoin[];
  filters?: QueryFilter[];
  orderBy?: QueryOrderBy;
  limit?: number;
}
