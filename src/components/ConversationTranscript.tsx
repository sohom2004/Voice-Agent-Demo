import React, { useRef, useEffect } from 'react';
import { 
  Volume2, 
  Play, 
  Pause, 
  RotateCcw, 
  Copy, 
  Check, 
  Sparkles, 
  FileCheck, 
  User as UserIcon,
  CornerDownRight
} from 'lucide-react';
import { Message } from '../types';

interface ConversationTranscriptProps {
  messages: Message[];
  activePlayingId: string | null;
  isPlayingAudio: boolean;
  onPlayAudio: (message: Message, rate?: number) => void;
  onStopAudio: () => void;
  onAskSuggested: (text: string) => void;
  speechRate: number;
}

export const ConversationTranscript: React.FC<ConversationTranscriptProps> = ({
  messages,
  activePlayingId,
  isPlayingAudio,
  onPlayAudio,
  onStopAudio,
  onAskSuggested,
  speechRate,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-5 py-4 px-2 sm:px-4">
      {messages.map((msg) => {
        const isAssistant = msg.role === 'assistant';
        const isCurrentPlaying = activePlayingId === msg.id && isPlayingAudio;

        return (
          <div
            key={msg.id}
            className={`flex flex-col gap-2 transition-all ${
              isAssistant ? 'items-start' : 'items-end'
            }`}
          >
            {/* Sender Metadata Bar */}
            <div className="flex items-center gap-2 text-[10px] tracking-wider uppercase opacity-50 px-1">
              {isAssistant ? (
                <>
                  <div className="w-4 h-4 rounded-full bg-emerald-400/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 font-bold text-[9px]">
                    N
                  </div>
                  <span className="font-semibold text-[#E0E2E6]">Natasha</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-[#E0E2E6]">You</span>
                  <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-slate-300">
                    <UserIcon className="w-2.5 h-2.5" />
                  </div>
                </>
              )}
              <span>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Bubble */}
            <div
              className={`relative max-w-[92%] sm:max-w-[85%] rounded-2xl p-5 backdrop-blur-md transition-all ${
                isAssistant
                  ? 'bg-white/[0.04] border border-white/10 text-[#E0E2E6] shadow-[0_4px_24px_rgba(0,0,0,0.4)]'
                  : 'bg-emerald-500/10 border border-emerald-400/30 text-white shadow-[0_0_20px_rgba(52,211,153,0.15)]'
              }`}
            >
              {/* Spoken Text with Natural Cadence */}
              <p className="text-sm sm:text-base leading-relaxed tracking-normal whitespace-pre-wrap font-normal select-text text-[#E0E2E6]">
                {msg.content}
              </p>

              {/* Grounded Documents Tag */}
              {isAssistant && msg.groundedDocuments && msg.groundedDocuments.length > 0 && (
                <div className="mt-3.5 pt-3 border-t border-white/10 flex flex-wrap items-center gap-1.5 text-[11px] opacity-80">
                  <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] uppercase tracking-wider opacity-60">Grounded in:</span>
                  {msg.groundedDocuments.map((docName, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-400/20 font-mono text-[10px]"
                    >
                      {docName}
                    </span>
                  ))}
                </div>
              )}

              {/* Assistant Message Audio Controls */}
              {isAssistant && (
                <div className="mt-3.5 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs opacity-80">
                  <div className="flex items-center gap-2">
                    {/* Play / Pause Voice */}
                    <button
                      onClick={() => {
                        if (isCurrentPlaying) {
                          onStopAudio();
                        } else {
                          onPlayAudio(msg, speechRate);
                        }
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-medium text-xs transition-all ${
                        isCurrentPlaying
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
                          : 'bg-white/5 text-[#E0E2E6] hover:bg-white/10 border border-white/10'
                      }`}
                      title={isCurrentPlaying ? 'Pause Audio' : 'Listen to Natasha speak'}
                    >
                      {isCurrentPlaying ? (
                        <>
                          <Pause className="w-3 h-3 fill-current" />
                          <span className="tracking-wider uppercase text-[10px]">Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span className="tracking-wider uppercase text-[10px]">Listen</span>
                        </>
                      )}
                    </button>

                    {/* Replay */}
                    <button
                      onClick={() => onPlayAudio(msg, speechRate)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-[#E0E2E6]/70 hover:text-white transition-colors"
                      title="Replay Voice"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>

                    {/* Copy Text */}
                    <button
                      onClick={() => copyToClipboard(msg.id, msg.content)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-[#E0E2E6]/70 hover:text-white transition-colors"
                      title="Copy response text"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Audio Status indicator */}
                  {isCurrentPlaying && (
                    <div className="flex items-center gap-1 text-emerald-400 text-[11px] font-medium animate-pulse">
                      <Volume2 className="w-3.5 h-3.5" />
                      <span className="tracking-wider uppercase text-[10px]">Audio Stream</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Suggested Spoken Follow-ups */}
            {isAssistant && msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
              <div className="mt-1 max-w-[92%] sm:max-w-[85%] pl-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest opacity-50 mb-2">
                  <Sparkles className="w-3 h-3 text-emerald-400" />
                  <span>Suggested follow-up</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {msg.suggestedQuestions.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => onAskSuggested(q)}
                      className="text-xs bg-white/5 hover:bg-white/10 text-[#E0E2E6]/90 hover:text-white px-3.5 py-1.5 rounded-xl border border-white/10 hover:border-emerald-400/30 transition-all text-left flex items-center gap-2 backdrop-blur-sm shadow-sm"
                    >
                      <CornerDownRight className="w-3 h-3 text-emerald-400/60 flex-shrink-0" />
                      <span>"{q}"</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};
