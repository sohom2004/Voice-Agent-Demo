import React, { useState } from 'react';
import { 
  FileText, 
  UploadCloud, 
  Trash2, 
  Eye, 
  CheckCircle2, 
  XCircle, 
  Sparkles, 
  X, 
  Plus, 
  FileCode, 
  RefreshCw 
} from 'lucide-react';
import { DocumentFile } from '../types';
import { SAMPLE_DOCUMENTS } from '../data/sampleDocs';

interface DocumentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  documents: DocumentFile[];
  onToggleDocument: (id: string) => void;
  onDeleteDocument: (id: string) => void;
  onAddDocuments: (files: DocumentFile[]) => void;
  onResetSamples: () => void;
  onAskQuestion: (question: string) => void;
}

export const DocumentDrawer: React.FC<DocumentDrawerProps> = ({
  isOpen,
  onClose,
  documents,
  onToggleDocument,
  onDeleteDocument,
  onAddDocuments,
  onResetSamples,
  onAskQuestion,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<DocumentFile | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);

  if (!isOpen) return null;

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsProcessingUpload(true);

    const newDocs: DocumentFile[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('workspaceId', 'default_workspace');

        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData
        });

        if (!res.ok) {
          throw new Error('Upload failed');
        }

        const data = await res.json();
        
        const docItem: DocumentFile = {
          id: data.id,
          name: data.name,
          type: data.fileType,
          size: data.size,
          uploadedAt: data.uploadedAt,
          enabled: true,
          status: data.status,
          summary: 'Queued for parsing and indexing...',
          suggestedQuestions: []
        };

        newDocs.push(docItem);
      } catch (err) {
        console.error('Failed to upload file:', file.name, err);
      }
    }

    if (newDocs.length > 0) {
      onAddDocuments(newDocs);
    }
    setIsProcessingUpload(false);
  };

  const activeCount = documents.filter(d => d.enabled).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-sm transition-opacity animate-fadeIn">
      <div className="w-full max-w-lg bg-[#0c0e12] border-l border-white/10 h-full flex flex-col shadow-2xl text-[#E0E2E6]">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-emerald-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider uppercase text-white flex items-center gap-2">
                Context Grounding
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-emerald-400/20 text-emerald-300 border border-emerald-400/30">
                  {activeCount} Active
                </span>
              </h2>
              <p className="text-xs opacity-50">
                Ground Natasha's voice answers in your project files
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[#E0E2E6]/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Drag and Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`border border-dashed rounded-2xl p-6 text-center transition-all ${
              dragOver
                ? 'border-emerald-400 bg-emerald-500/10 scale-[1.01]'
                : 'border-white/15 bg-white/[0.02] hover:border-emerald-400/40 hover:bg-white/[0.04]'
            }`}
          >
            <input
              type="file"
              id="doc-file-input"
              multiple
              accept=".txt,.md,.json,.csv,.py,.js,.ts,.tsx,.html,.css,.yaml,.yml,.pdf,.docx,.xlsx,.xls"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <label
              htmlFor="doc-file-input"
              className="cursor-pointer flex flex-col items-center gap-2.5"
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-400/10 text-emerald-400 flex items-center justify-center border border-emerald-400/20 shadow-[0_0_12px_rgba(52,211,153,0.2)]">
                <UploadCloud className="w-5 h-5" />
              </div>
              <div className="text-sm font-semibold text-white">
                {isProcessingUpload ? 'Ingesting documents...' : 'Drop notes, specifications, or code'}
              </div>
              <p className="text-xs opacity-50">
                Supports PDF, Word, Excel, Markdown, TXT, CSV & Code
              </p>
              <span className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/5 text-[#E0E2E6] border border-white/10 hover:bg-white/10 transition-colors">
                <Plus className="w-3.5 h-3.5 text-emerald-400" /> Select Files
              </span>
            </label>
          </div>

          {/* Active Documents List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase tracking-[0.2em] font-semibold opacity-50">
                Active Knowledge Base ({documents.length})
              </span>
              {documents.length === 0 && (
                <button
                  onClick={onResetSamples}
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Load Sample Docs
                </button>
              )}
            </div>

            {documents.length === 0 ? (
              <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/10 text-center">
                <FileText className="w-8 h-8 opacity-30 mx-auto mb-2" />
                <p className="text-sm opacity-60 font-medium">No documents attached</p>
                <p className="text-xs opacity-40 mt-1">
                  Upload a file above or click below to load demo architecture notes.
                </p>
                <button
                  onClick={onResetSamples}
                  className="mt-3 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 hover:bg-emerald-500/30 transition-colors inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Load Sample Docs
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => {
                  const isProcessing = doc.status === 'uploaded' || doc.status === 'processing';
                  const isFailed = doc.status === 'failed';
                  const isReady = doc.status === 'ready' || !doc.status;

                  return (
                    <div
                      key={doc.id}
                      className={`p-4 rounded-2xl border transition-all ${
                        doc.enabled
                          ? 'bg-white/5 border-emerald-400/30 shadow-[0_0_15px_rgba(52,211,153,0.08)]'
                          : 'bg-white/[0.02] border-white/5 opacity-50'
                      }`}
                    >
                      {/* Top Row: File Name & Controls */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-400/20 flex items-center justify-center text-emerald-400 text-[10px] font-bold font-mono">
                            {doc.type.toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white truncate" title={doc.name}>
                              {doc.name}
                            </p>
                            <p className="text-[10px] opacity-40 flex items-center gap-1.5">
                              <span>{Math.round(doc.size / 1024)} KB</span>
                              <span>•</span>
                              {isProcessing && (
                                <span className="text-amber-400 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                  Indexing...
                                </span>
                              )}
                              {isFailed && (
                                <span className="text-red-400 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                  Failed
                                </span>
                              )}
                              {isReady && (
                                <span className="text-emerald-400 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  Ready
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          {/* Toggle active switch */}
                          <button
                            onClick={() => onToggleDocument(doc.id)}
                            className={`p-1.5 rounded-lg text-xs font-medium transition-colors ${
                              doc.enabled
                                ? 'text-emerald-400 hover:bg-emerald-500/10'
                                : 'text-slate-500 hover:bg-white/5'
                            }`}
                            title={doc.enabled ? 'Enabled in context (Click to disable)' : 'Disabled (Click to enable)'}
                            disabled={isProcessing}
                          >
                            {doc.enabled ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                          </button>

                          {/* Preview */}
                          <button
                            onClick={() => setSelectedPreviewDoc(doc)}
                            className="p-1.5 rounded-lg text-[#E0E2E6]/60 hover:text-white hover:bg-white/5 transition-colors"
                            title="Preview document"
                            disabled={isProcessing || !doc.content}
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => onDeleteDocument(doc.id)}
                            className="p-1.5 rounded-lg text-[#E0E2E6]/60 hover:text-amber-400 hover:bg-white/5 transition-colors"
                            title="Remove file"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Error details if failed */}
                      {isFailed && doc.error && (
                        <p className="mt-2 text-[10px] text-red-400 bg-red-500/10 p-2 rounded-xl border border-red-500/20">
                          {doc.error}
                        </p>
                      )}

                      {/* Summary */}
                      {doc.summary && (
                        <p className="mt-2 text-xs opacity-75 leading-relaxed bg-white/[0.02] p-2.5 rounded-xl border border-white/5">
                          {doc.summary}
                        </p>
                      )}

                      {/* Suggested Spoken Questions */}
                      {doc.suggestedQuestions && doc.suggestedQuestions.length > 0 && doc.enabled && (
                        <div className="mt-2.5 pt-2 border-t border-white/5">
                          <p className="text-[10px] uppercase tracking-wider font-semibold opacity-40 mb-1.5 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-emerald-400" />
                            Suggested voice queries
                          </p>
                          <div className="flex flex-col gap-1">
                            {doc.suggestedQuestions.map((q, idx) => (
                              <button
                                key={idx}
                                onClick={() => {
                                  onAskQuestion(q);
                                  onClose();
                                }}
                                className="text-left text-xs text-emerald-300/80 hover:text-emerald-200 hover:bg-emerald-500/10 px-2 py-1 rounded-lg transition-colors truncate"
                              >
                                "{q}"
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between text-xs opacity-60">
          <span>{activeCount} active in context engine</span>
          <button
            onClick={onResetSamples}
            className="hover:text-emerald-400 flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Reset Demo Files
          </button>
        </div>
      </div>

      {/* Document Content Preview Modal */}
      {selectedPreviewDoc && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0c0e12] border border-white/10 rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-sm truncate">
                  {selectedPreviewDoc.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedPreviewDoc(null)}
                className="p-1 rounded-lg text-[#E0E2E6]/60 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 font-mono text-xs text-[#E0E2E6]/90 leading-relaxed whitespace-pre-wrap select-text bg-[#050608] m-3 rounded-2xl border border-white/10">
              {selectedPreviewDoc.content}
            </div>
            <div className="p-3 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setSelectedPreviewDoc(null)}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-white"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
