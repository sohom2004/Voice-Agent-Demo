import { DatabaseConnector } from '../connectors/base';

export class DataSampler {
  /**
   * Samples rows from a table and masks sensitive fields (passwords, tokens, cards, ssn, etc.).
   */
  async sampleAndMask(
    connector: DatabaseConnector, 
    tableName: string, 
    sampleSize = 10
  ): Promise<any[]> {
    try {
      const rows = await connector.sampleTable(tableName, sampleSize);
      if (rows.length === 0) return [];

      // Mask sensitive columns and values
      return rows.map(row => {
        const maskedRow: Record<string, any> = {};
        
        for (const [key, val] of Object.entries(row)) {
          const colNameLower = key.toLowerCase();
          
          // Check if column name suggests sensitivity
          if (this.isSensitiveColumnName(colNameLower)) {
            maskedRow[key] = '[MASKED_SENSITIVE_KEY]';
            continue;
          }

          // Check if value suggests sensitivity (e.g. email, ssn, card patterns)
          if (val !== null && val !== undefined) {
            const valStr = String(val);
            if (this.isSensitiveValuePattern(valStr)) {
              maskedRow[key] = '[MASKED_SENSITIVE_PATTERN]';
              continue;
            }
          }

          maskedRow[key] = val;
        }
        
        return maskedRow;
      });
    } catch (err) {
      console.warn(`[Data Sampler] Failed to sample table ${tableName}:`, err);
      return [];
    }
  }

  private isSensitiveColumnName(colName: string): boolean {
    const terms = [
      'password', 'pass', 'hash', 'salt', 'secret', 'token', 
      'api_key', 'apikey', 'credential', 'auth', 'private',
      'credit', 'card', 'cvv', 'ssn', 'social_security',
      'aadhaar', 'tax_id', 'passport', 'routing', 'account_number'
    ];
    return terms.some(term => colName.includes(term));
  }

  private isSensitiveValuePattern(val: string): boolean {
    // 1. Social Security Number: XXX-XX-XXXX or XXXXXXXXX
    const ssnRegex = /^\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b$/;
    
    // 2. Credit Cards: 13 to 19 digits (optional spaces/hyphens)
    const creditCardRegex = /\b(?:\d[ -]*?){13,19}\b/;
    
    // 3. Common Token patterns (JWT-like or hex API keys of length 32+)
    const tokenRegex = /\b[A-Za-z0-9-_]{32,}\b/;

    return ssnRegex.test(val) || (creditCardRegex.test(val) && val.replace(/[^\d]/g, '').length >= 13) || tokenRegex.test(val);
  }
}
