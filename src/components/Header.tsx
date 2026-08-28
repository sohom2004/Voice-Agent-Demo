import React from 'react';
import { Sparkles, FileText, Settings, RotateCcw, Volume2, Radio, PhoneCall, PhoneOff } from 'lucide-react';
import { AgentState, LiveConnectionState } from '../types';

interface HeaderProps {
  agentState: AgentState;
  liveStatus: LiveConnectionState;
  isLiveActive: boolean;
  onToggleLive: () => void;
  activeDocsCount: number;
  totalDocsCount: number;
  onToggleDocs: () => void;
  onToggleSettings: () => void;
  onNewSession: () => void;
  continuousMode: boolean;
  onToggleContinuous: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  agentState,
  liveStatus,
  isLiveActive,
  onToggleLive,
  activeDocsCount,
  onToggleDocs,
  onToggleSettings,
  onNewSession,
  continuousMode,
  onToggleContinuous,
}) => {
  const getStatusIndicator = () => {
    if (liveStatus === 'connecting') {
      return (
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-amber-400 rounded-full shadow-[0_0_12px_rgba(251,191,36,0.9)] animate-pulse"></div>
          <span className="text-[11px] font-bold tracking-[0.25em] uppercase text-amber-400">
            Connecting Real-Time Live...
          </span>
        </div>
      );
    }
    if (isLiveActive) {
      if (agentState === 'speaking') {
        return (
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-cyan-400 rounded-full shadow-[0_0_12px_rgba(34,211,238,0.9)] animate-ping"></div>
            <span className="text-[11px] font-bold tracking-[0.25em] uppercase text-cyan-300 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" /> Natasha Speaking // Live Duplex
            </span>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full shadow-[0_0_15px_rgba(52,211,153,0.9)] animate-pulse"></div>
          <span className="text-[11px] font-bold tracking-[0.25em] uppercase text-emerald-300">
            Live Voice Stream // Duplex Active
          </span>
        </div>
      );
    }
    switch (agentState) {
      case 'listening':
        return (
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full shadow-[0_0_12px_rgba(52,211,153,0.9)] animate-pulse"></div>
            <span className="text-[11px] font-bold tracking-[0.25em] uppercase text-emerald-400">
              Voice Active // Listening
            </span>
          </div>
        );
      case 'processing':
        return (
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-amber-400 rounded-full shadow-[0_0_12px_rgba(251,191,36,0.9)] animate-pulse"></div>
            <span className="text-[11px] font-bold tracking-[0.25em] uppercase text-amber-400">
              Synthesizing...
            </span>
          </div>
        );
      case 'speaking':
        return (
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-cyan-400 rounded-full shadow-[0_0_12px_rgba(34,211,238,0.9)] animate-ping"></div>
            <span className="text-[11px] font-bold tracking-[0.25em] uppercase text-cyan-300 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" /> Natasha Speaking
            </span>
          </div>
        );
      case 'muted':
        return (
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-slate-500 rounded-full"></div>
            <span className="text-[11px] font-bold tracking-[0.25em] uppercase opacity-50">
              Muted
            </span>
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 bg-emerald-400/80 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.6)]"></div>
            <span className="text-[11px] font-bold tracking-[0.25em] uppercase opacity-70">
              Natasha // Standby
            </span>
          </div>
        );
    }
  };

  return (
    <header className="z-20 w-full backdrop-blur-md bg-white/[0.02] border-b border-white/10 px-4 sm:px-8 py-4 shrink-0 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Left: Brand Identity with Immersive Tracked Monogram */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.15)]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-wider text-[#E0E2E6]">NATASHA</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase bg-white/5 text-emerald-400/90 border border-white/10 tracking-widest">
                  Live Duplex v4.0
                </span>
              </div>
              <div className="hidden sm:block">
                {getStatusIndicator()}
              </div>
            </div>
          </div>
        </div>

        {/* Center: System Telemetry */}
        <div className="hidden lg:flex items-center gap-6 text-[10px] font-medium tracking-[0.2em] uppercase opacity-50">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Gemini Live Stream
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            PCM 24kHz Duplex
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2.5">
          {/* Live Call Real-Time Duplex Toggle */}
          <button
            onClick={onToggleLive}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold tracking-wider uppercase transition-all shadow-sm ${
              isLiveActive
                ? 'bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30'
                : 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/25 shadow-[0_0_12px_rgba(52,211,153,0.25)]'
            }`}
            title={isLiveActive ? 'End Live Real-Time Call' : 'Start Real-Time Voice Call (Gemini Live)'}
          >
            {isLiveActive ? (
              <>
                <PhoneOff className="w-3.5 h-3.5 text-red-400" />
                <span>End Live Call</span>
              </>
            ) : (
              <>
                <PhoneCall className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>Live Call</span>
              </>
            )}
          </button>

          {/* Documents Drawer Button */}
          <button
            onClick={onToggleDocs}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeDocsCount > 0
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-white/5 text-[#E0E2E6]/70 border border-white/10 hover:bg-white/10'
            }`}
            title="Manage context grounding documents"
          >
            <FileText className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline text-[11px] tracking-wider uppercase">Context</span>
            {activeDocsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-md bg-emerald-400/20 text-emerald-300 text-[10px] font-mono border border-emerald-400/30">
                {activeDocsCount}
              </span>
            )}
          </button>

          {/* Voice Settings Button */}
          <button
            onClick={onToggleSettings}
            className="p-2 rounded-xl text-[#E0E2E6]/60 hover:text-[#E0E2E6] bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
            title="Voice & Speech Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* New Session Button */}
          <button
            onClick={onNewSession}
            className="p-2 rounded-xl text-[#E0E2E6]/60 hover:text-amber-400 bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
            title="Reset Session"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

