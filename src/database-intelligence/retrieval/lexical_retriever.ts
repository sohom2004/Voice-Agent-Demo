import { pool } from '../../storage/dbSetup';

export interface LexicalMatchResult {
  tableId: string;
  tableName: string;
  schemaName: string;
  matchScore: number; // For weighting matches
}

export class LexicalRetriever {
  /**
   * Matches database tables based on keywords.
   */
  async retrieve(connectionId: string, queryText: string): Promise<LexicalMatchResult[]> {
    if (!queryText.trim()) return [];

    // Split words to search for multiple terms
    const words = queryText
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 2);

    if (words.length === 0) return [];

    const matchesMap = new Map<string, LexicalMatchResult>();

    // For each word, query tables, columns, semantic metadata, and synonym lists
    for (const word of words) {
      const termPattern = `%${word}%`;
      const res = await pool.query(`
        SELECT DISTINCT t.id, t.name, t.schema_name,
          CASE 
            WHEN t.name ILIKE $2 THEN 3.0 -- Name match is highest weight
            WHEN EXISTS (SELECT 1 FROM db_columns col WHERE col.table_id = t.id AND col.name ILIKE $2) THEN 2.0
            ELSE 1.0
          END AS match_weight
        FROM db_tables t
        LEFT JOIN db_semantic_metadata s ON s.table_id = t.id
        WHERE t.connection_id = $1
          AND (
            t.name ILIKE $2
            OR EXISTS (SELECT 1 FROM db_columns col WHERE col.table_id = t.id AND col.name ILIKE $2)
            OR s.semantic_description ILIKE $2
            OR EXISTS (SELECT 1 FROM unnest(s.business_concepts) bc WHERE bc ILIKE $2)
            OR EXISTS (SELECT 1 FROM unnest(s.synonyms) syn WHERE syn ILIKE $2)
          );
      `, [connectionId, termPattern]);

      res.rows.forEach(row => {
        const existing = matchesMap.get(row.id);
        if (existing) {
          existing.matchScore += row.match_weight;
        } else {
          matchesMap.set(row.id, {
            tableId: row.id,
            tableName: row.name,
            schemaName: row.schema_name,
            matchScore: row.match_weight
          });
        }
      });
    }

    return Array.from(matchesMap.values()).sort((a, b) => b.matchScore - a.matchScore);
  }
}
