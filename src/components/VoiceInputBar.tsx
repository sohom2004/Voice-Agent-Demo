import React from 'react';
import { Mic, MicOff, Paperclip, Square } from 'lucide-react';
import { AgentState } from '../types';

interface VoiceInputBarProps {
  agentState: AgentState;
  isLiveActive: boolean;
  onToggleListen: () => void;
  onToggleLive: () => void;
  onStopSpeaking: () => void;
  onOpenDocs: () => void;
  isProcessing: boolean;
}

export const VoiceInputBar: React.FC<VoiceInputBarProps> = ({
  agentState,
  isLiveActive,
  onToggleListen,
  onToggleLive,
  onStopSpeaking,
  onOpenDocs,
  isProcessing,
}) => {
  const statusLabel = isLiveActive
    ? agentState === 'speaking'
      ? 'Live call · Natasha speaking — tap interrupt to barge in'
      : agentState === 'muted'
      ? 'Live call · Microphone muted'
      : 'Live call · Listening — speak freely'
    : agentState === 'processing' || isProcessing
    ? 'Connecting voice session…'
    : 'Voice control strip · Start a live call to talk';

  return (
    <div className="sticky bottom-0 z-20 w-full backdrop-blur-xl bg-[#050608]/85 border-t border-white/10 p-3 sm:p-4">
      <div className="max-w-3xl mx-auto flex items-center gap-2.5">
        {/* Document Attachment Button */}
        <button
          type="button"
          onClick={onOpenDocs}
          className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 text-[#E0E2E6]/70 hover:text-emerald-300 border border-white/10 transition-all flex-shrink-0"
          title="Attach or manage documents"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Status strip (replaces text composer) */}
        <div className="flex-1 min-w-0 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm text-slate-400 truncate">
          {statusLabel}
        </div>

        {/* Interrupt while speaking */}
        {agentState === 'speaking' && (
          <button
            type="button"
            onClick={onStopSpeaking}
            className="p-3 rounded-2xl bg-white/5 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 transition-all flex-shrink-0"
            title="Interrupt and stop speaking"
          >
            <Square className="w-4 h-4 fill-current" />
          </button>
        )}

        {/* Mic / live toggle */}
        <button
          type="button"
          onClick={isLiveActive ? onToggleListen : onToggleLive}
          className={`p-3 rounded-2xl transition-all flex-shrink-0 flex items-center justify-center ${
            isLiveActive
              ? agentState === 'muted'
                ? 'bg-slate-700 text-slate-300 border border-slate-500/50'
                : 'bg-emerald-400 text-slate-950 shadow-[0_0_20px_rgba(52,211,153,0.8)] animate-pulse'
              : agentState === 'listening'
              ? 'bg-emerald-400 text-slate-950 shadow-[0_0_20px_rgba(52,211,153,0.8)] animate-pulse'
              : 'bg-white/5 hover:bg-white/10 border border-white/10 text-emerald-400 hover:text-emerald-300 shadow-[0_0_15px_rgba(52,211,153,0.15)]'
          }`}
          title={
            isLiveActive
              ? 'Toggle Microphone Mute in Live Call'
              : 'Start Real-Time Duplex Voice Call'
          }
        >
          {isLiveActive ? (
            agentState === 'muted' ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />
          ) : agentState === 'listening' ? (
            <MicOff className="w-5 h-5" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
};
