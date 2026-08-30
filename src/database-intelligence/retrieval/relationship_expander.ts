import { pool } from '../../storage/dbSetup';
import { RelationshipMetadata } from '../connectors/base';

export class RelationshipExpander {
  /**
   * Finds connections/relationships linking a set of candidate tables.
   * If a direct connection doesn't exist, it attempts to find intermediate bridge tables
   * and returns the expanded set of tables and relationships.
   */
  async expand(connectionId: string, tableNames: string[]): Promise<{
    expandedTables: string[];
    relationships: RelationshipMetadata[];
  }> {
    if (tableNames.length <= 1) {
      return { expandedTables: [...tableNames], relationships: [] };
    }

    // 1. Load all relationships for this connection
    const res = await pool.query(`
      SELECT source_table, source_column, target_table, target_column, relationship_type
      FROM db_relationships
      WHERE connection_id = $1;
    `, [connectionId]);

    const allRels: RelationshipMetadata[] = res.rows.map(row => ({
      sourceTable: row.source_table,
      sourceColumn: row.source_column,
      targetTable: row.target_table,
      targetColumn: row.target_column,
      relationshipType: row.relationship_type as any
    }));

    const resultTables = new Set<string>(tableNames);
    const resultRels: RelationshipMetadata[] = [];

    // Simple BFS / shortest path algorithm to find how the candidate tables connect to each other.
    // Since relational schemas for one client database connection are small (typically < 30 tables), this is extremely fast.
    for (let i = 0; i < tableNames.length; i++) {
      for (let j = i + 1; j < tableNames.length; j++) {
        const start = tableNames[i];
        const end = tableNames[j];
        
        const path = this.findPath(start, end, allRels);
        if (path) {
          path.forEach(rel => {
            resultTables.add(rel.sourceTable);
            resultTables.add(rel.targetTable);
            
            // Add if not already present
            if (!resultRels.some(r => r.sourceTable === rel.sourceTable && r.sourceColumn === rel.sourceColumn && r.targetTable === rel.targetTable)) {
              resultRels.push(rel);
            }
          });
        }
      }
    }

    return {
      expandedTables: Array.from(resultTables),
      relationships: resultRels
    };
  }

  private findPath(start: string, end: string, rels: RelationshipMetadata[]): RelationshipMetadata[] | null {
    interface QueueItem {
      table: string;
      path: RelationshipMetadata[];
    }

    const queue: QueueItem[] = [{ table: start, path: [] }];
    const visited = new Set<string>([start]);

    while (queue.length > 0) {
      const { table, path } = queue.shift()!;

      if (table === end) {
        return path;
      }

      // Find connections in either direction (FK source -> target or target -> source)
      const connections = rels.filter(rel => rel.sourceTable === table || rel.targetTable === table);

      for (const rel of connections) {
        const nextTable = rel.sourceTable === table ? rel.targetTable : rel.sourceTable;
        if (!visited.has(nextTable)) {
          visited.add(nextTable);
          queue.push({
            table: nextTable,
            path: [...path, rel]
          });
        }
      }
    }

    return null; // No path found
  }
}
