import { IntelRepository, DbTableRecord, DbColumnRecord, DbCapabilityRecord } from '../storage/intelRepository';
import { RelationshipMetadata } from '../connectors/base';

export class ContextBuilder {
  private intelRepo = new IntelRepository();

  /**
   * Assembles retrieved schema details and capabilities into a compact XML structure for LLM prompts.
   */
  async buildContext(
    connectionId: string,
    tableNames: string[],
    relationships: RelationshipMetadata[],
    capabilities: any[]
  ): Promise<string> {
    const allTables = await this.intelRepo.getTablesMetadata(connectionId);
    
    // Filter to retrieved tables only
    const matchedTables = allTables.filter(t => tableNames.includes(t.name));

    let xml = '<database_intelligence>\n';

    // 1. Tables and Columns
    xml += '  <tables>\n';
    for (const table of matchedTables) {
      const columns = await this.intelRepo.getTableColumns(table.id);
      
      // HIDE highly_sensitive columns completely from the LLM schema context to enforce security
      const visibleCols = columns.filter(c => c.classification !== 'highly_sensitive');

      const colStrings = visibleCols.map(c => {
        let suffix = '';
        if (c.isPrimaryKey) suffix += ' [PK]';
        if (c.isForeignKey) suffix += ' [FK]';
        if (c.classification === 'sensitive') suffix += ' (sensitive: mask/filter)';
        return `      <column name="${c.name}" type="${c.dataType}"${suffix} />`;
      }).join('\n');

      xml += `    <table name="${table.name}" schema="${table.schemaName}">\n`;
      if (table.description) {
        xml += `      <description>${table.description}</description>\n`;
      }
      xml += '      <columns>\n';
      xml += colStrings + '\n';
      xml += '      </columns>\n';
      xml += '    </table>\n';
    }
    xml += '  </tables>\n';

    // 2. Relationships
    if (relationships.length > 0) {
      xml += '  <relationships>\n';
      relationships.forEach(rel => {
        xml += `    <relationship source="${rel.sourceTable}.${rel.sourceColumn}" target="${rel.targetTable}.${rel.targetColumn}" type="${rel.relationshipType}" />\n`;
      });
      xml += '  </relationships>\n';
    }

    // 3. High-level capabilities
    if (capabilities.length > 0) {
      xml += '  <capabilities>\n';
      capabilities.forEach(cap => {
        xml += `    <capability name="${cap.name}" type="${cap.type}">\n`;
        xml += `      <description>${cap.description}</description>\n`;
        xml += `      <required_context>${cap.requiredContext.join(', ')}</required_context>\n`;
        xml += `      <relevant_tables>${cap.relevantTables.join(', ')}</relevant_tables>\n`;
        xml += '    </capability>\n';
      });
      xml += '  </capabilities>\n';
    }

    xml += '</database_intelligence>';
    return xml;
  }
}
