import { createRequire } from 'module';
const requireCjs = createRequire(import.meta.url);
const pdf = requireCjs('pdf-parse');

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { DocumentParser } from '../shared/interfaces';
import { CanonicalDocument, DocumentSection } from '../shared/types';

export class PlainTextAndMarkdownParser implements DocumentParser {
  supports(fileType: string): boolean {
    const ext = fileType.toLowerCase();
    return ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'text';
  }

  async parse(filePath: string, buffer: Buffer, fileName: string): Promise<CanonicalDocument> {
    const text = buffer.toString('utf8');
    const sections: DocumentSection[] = [];
    
    // Simple markdown parsing to extract headings vs paragraph structure
    const lines = text.split('\n');
    let currentSection: DocumentSection | null = null;
    let paragraphIndex = 1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for markdown headings (# Heading, ## Heading, etc.)
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const headingLevel = headingMatch[1].length;
        const title = headingMatch[2];
        
        const newSection: DocumentSection = {
          id: `sec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          title,
          type: 'section',
          content: '',
          children: []
        };
        
        sections.push(newSection);
        currentSection = newSection;
      } else {
        const para: DocumentSection = {
          id: `para_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type: 'paragraph',
          content: trimmed
        };

        if (currentSection) {
          currentSection.children = currentSection.children || [];
          currentSection.children.push(para);
        } else {
          // Top-level paragraph before any headings
          sections.push(para);
        }
      }
    }

    return {
      documentId: '', // Filled in by ingestion worker
      workspaceId: '', // Filled in by ingestion worker
      name: fileName,
      fileType: 'markdown',
      sections,
      metadata: {}
    };
  }
}

export class PdfDocumentParser implements DocumentParser {
  supports(fileType: string): boolean {
    return fileType.toLowerCase() === 'pdf';
  }

  async parse(filePath: string, buffer: Buffer, fileName: string): Promise<CanonicalDocument> {
    const parser = new pdf.PDFParse({ data: new Uint8Array(buffer) });
    const parsedPdf = await parser.getText();
    const text = parsedPdf.text || '';
    await parser.destroy();
    
    // Normalize newlines from PDF physical layout to form clean semantic paragraphs
    const lines = text.split('\n').map(line => line.trim());
    let normalizedText = '';
    for (const line of lines) {
      if (line === '') {
        normalizedText += '\n\n';
      } else {
        normalizedText += (normalizedText.endsWith('\n\n') || normalizedText === '') ? line : ' ' + line;
      }
    }

    const paragraphs = normalizedText
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean);

    const sections: DocumentSection[] = paragraphs.map((paraText, idx) => ({
      id: `pdf_p_${idx}_${Date.now()}`,
      type: 'paragraph',
      content: paraText,
      source: { page: 1 } // pdf-parse extracts continuous text, page numbers can be refined if needed
    }));

    return {
      documentId: '',
      workspaceId: '',
      name: fileName,
      fileType: 'pdf',
      sections,
      metadata: {
        numPages: parsedPdf.numpages,
        info: parsedPdf.info
      }
    };
  }
}

export class DocxDocumentParser implements DocumentParser {
  supports(fileType: string): boolean {
    return fileType.toLowerCase() === 'docx';
  }

  async parse(filePath: string, buffer: Buffer, fileName: string): Promise<CanonicalDocument> {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || '';
    
    const paragraphs = text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean);

    const sections: DocumentSection[] = paragraphs.map((paraText, idx) => ({
      id: `docx_p_${idx}_${Date.now()}`,
      type: 'paragraph',
      content: paraText
    }));

    return {
      documentId: '',
      workspaceId: '',
      name: fileName,
      fileType: 'docx',
      sections,
      metadata: {}
    };
  }
}

export class ExcelAndCsvParser implements DocumentParser {
  supports(fileType: string): boolean {
    const ext = fileType.toLowerCase();
    return ext === 'xlsx' || ext === 'xls' || ext === 'csv';
  }

  async parse(filePath: string, buffer: Buffer, fileName: string): Promise<CanonicalDocument> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sections: DocumentSection[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      // Convert sheet to JSON rows
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length === 0) continue;

      // Extract columns / headers
      const columns = Object.keys(rows[0]);

      const sheetSection: DocumentSection = {
        id: `sheet_${sheetName}_${Date.now()}`,
        title: `Sheet: ${sheetName}`,
        type: 'section',
        content: `Excel Sheet: ${sheetName}. Columns: ${columns.join(', ')}`,
        children: [],
        source: { sheet: sheetName }
      };

      // Each row forms a table record paragraph
      rows.forEach((row, rowIdx) => {
        const rowText = Object.entries(row)
          .map(([key, val]) => `${key}: ${val}`)
          .join('\n');
        
        sheetSection.children?.push({
          id: `row_${sheetName}_${rowIdx}_${Date.now()}`,
          type: 'table',
          content: rowText,
          source: { sheet: sheetName, row: rowIdx + 1 }
        });
      });

      sections.push(sheetSection);
    }

    return {
      documentId: '',
      workspaceId: '',
      name: fileName,
      fileType: fileName.endsWith('.csv') ? 'csv' : 'xlsx',
      sections,
      metadata: {
        sheets: workbook.SheetNames
      }
    };
  }
}

export class DocumentParserRouter {
  private parsers: DocumentParser[];

  constructor() {
    this.parsers = [
      new PlainTextAndMarkdownParser(),
      new PdfDocumentParser(),
      new DocxDocumentParser(),
      new ExcelAndCsvParser()
    ];
  }

  async parse(filePath: string, buffer: Buffer, fileName: string): Promise<CanonicalDocument> {
    const ext = fileName.split('.').pop() || '';
    const parser = this.parsers.find(p => p.supports(ext));
    if (!parser) {
      throw new Error(`Unsupported file type: ${ext} for file: ${fileName}`);
    }
    return parser.parse(filePath, buffer, fileName);
  }
}
