import { CanonicalDocument, DocumentChunk, DocumentSection } from '../shared/types';

export class DocumentChunker {
  private targetSize: number; // target size in characters (e.g., 1000 chars is ~200-250 words)
  private overlap: number;

  constructor(targetSize = 1000, overlap = 150) {
    this.targetSize = targetSize;
    this.overlap = overlap;
  }

  public chunk(doc: CanonicalDocument): Omit<DocumentChunk, 'id'>[] {
    const chunks: Omit<DocumentChunk, 'id'>[] = [];
    let chunkIndex = 0;

    const enrichContent = (docName: string, path: string[], text: string) => {
      const pathHeader = path.length > 0 ? ` > ${path.join(' > ')}` : '';
      return `[Source: ${docName}${pathHeader}]\n\n${text}`;
    };

    // Helper to walk the section tree recursively
    const walk = (
      sections: DocumentSection[],
      currentPath: string[],
      metadata: Record<string, any>
    ) => {
      let buffer = '';
      let bufferMetadata: Record<string, any> = { ...metadata };

      const flushBuffer = () => {
        if (!buffer.trim()) return;
        const enriched = enrichContent(doc.name, currentPath, buffer.trim());
        chunks.push({
          workspaceId: doc.workspaceId,
          documentId: doc.documentId,
          documentName: doc.name,
          sectionPath: [...currentPath],
          chunkIndex: chunkIndex++,
          content: enriched,
          metadata: {
            sourceType: doc.fileType,
            ...bufferMetadata
          }
        });
        buffer = '';
      };

      for (const section of sections) {
        // Build the section path
        const sectionPath = section.title 
          ? [...currentPath, section.title] 
          : currentPath;

        // If the section has content, process it
        if (section.content) {
          const sectionHeader = section.title ? `### ${section.title}\n` : '';
          const contentToAppend = sectionHeader + section.content;

          // If adding this content exceeds target size, flush first
          if (buffer.length + contentToAppend.length > this.targetSize && buffer.length > 0) {
            flushBuffer();
          }

          // Accumulate metadata from the section (e.g. page, sheet, row)
          if (section.source) {
            bufferMetadata = { ...bufferMetadata, ...section.source };
          }

          buffer += (buffer ? '\n\n' : '') + contentToAppend;
        }

        // If it has children, walk them
        if (section.children && section.children.length > 0) {
          // If buffer is already near target, flush it first to keep child sections separate
          if (buffer.length > this.targetSize * 0.7) {
            flushBuffer();
          }
          
          walk(section.children, sectionPath, { ...bufferMetadata });
        } else {
          // If it's a leaf node paragraph and it's huge, we check if we need to split it
          if (section.content && section.content.length > this.targetSize) {
            flushBuffer(); // Flush anything prior
            
            // Chunk huge paragraphs by sentences
            const sentences = section.content.match(/[^.!?]+[.!?]+(\s|$)/g) || [section.content];
            let subBuffer = '';
            
            for (const sentence of sentences) {
              if (subBuffer.length + sentence.length > this.targetSize && subBuffer.length > 0) {
                const enriched = enrichContent(doc.name, sectionPath, subBuffer.trim());
                chunks.push({
                  workspaceId: doc.workspaceId,
                  documentId: doc.documentId,
                  documentName: doc.name,
                  sectionPath: [...sectionPath],
                  chunkIndex: chunkIndex++,
                  content: enriched,
                  metadata: {
                    sourceType: doc.fileType,
                    ...section.source
                  }
                });
                // Carry over overlap
                subBuffer = subBuffer.slice(-this.overlap);
              }
              subBuffer += sentence;
            }
            
            if (subBuffer.trim()) {
              buffer = subBuffer;
              bufferMetadata = { ...bufferMetadata, ...section.source };
            }
          }
        }
      }

      // Flush remaining content in buffer
      flushBuffer();
    };

    walk(doc.sections, [], {});
    return chunks;
  }
}
