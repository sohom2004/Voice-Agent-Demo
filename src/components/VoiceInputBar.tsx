import React, { useState } from 'react';
import { Mic, MicOff, Send, Paperclip, Square, PhoneCall } from 'lucide-react';
import { AgentState } from '../types';

interface VoiceInputBarProps {
  agentState: AgentState;
  isLiveActive: boolean;
  onSendMessage: (text: string) => void;
  onToggleListen: () => void;
  onToggleLive: () => void;
  onStopSpeaking: () => void;
  onOpenDocs: () => void;
  isProcessing: boolean;
}

export const VoiceInputBar: React.FC<VoiceInputBarProps> = ({
  agentState,
  isLiveActive,
  onSendMessage,
  onToggleListen,
  onToggleLive,
  onStopSpeaking,
  onOpenDocs,
  isProcessing,
}) => {
  const [inputText, setInputText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isProcessing) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div className="sticky bottom-0 z-20 w-full backdrop-blur-xl bg-[#050608]/85 border-t border-white/10 p-3 sm:p-4">
      <div className="max-w-3xl mx-auto">
        <form onSubmit={handleSubmit} className="flex items-center gap-2.5">
          {/* Document Attachment Button */}
          <button
            type="button"
            onClick={onOpenDocs}
            className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 text-[#E0E2E6]/70 hover:text-emerald-300 border border-white/10 transition-all flex-shrink-0"
            title="Attach or manage documents"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Text Input */}
          <div className="relative flex-1">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                isLiveActive
                  ? agentState === 'speaking'
                    ? 'Live call active... Natasha speaking (Type or talk to interrupt)'
                    : 'Live call active... Speak freely or type a message'
                  : agentState === 'listening'
                  ? 'Listening continuously... Speak anytime'
                  : agentState === 'speaking'
                  ? 'Natasha is speaking... Type or tap mic to interrupt'
                  : 'Ask Natasha anything or start a live voice conversation...'
              }
              disabled={isProcessing}
              className="w-full bg-white/5 text-[#E0E2E6] placeholder-slate-500 text-sm rounded-2xl px-4 py-3 border border-white/10 focus:outline-none focus:border-emerald-400/60 focus:ring-1 focus:ring-emerald-400/40 transition-all backdrop-blur-md"
            />
          </div>

          {/* If Natasha is speaking, show interrupt/stop button */}
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

          {/* Voice Microphone Toggle Button */}
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

          {/* Send text button (if text entered) */}
          {inputText.trim().length > 0 && (
            <button
              type="submit"
              disabled={isProcessing}
              className="p-3 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-bold shadow-[0_0_15px_rgba(52,211,153,0.5)] transition-all flex-shrink-0"
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

