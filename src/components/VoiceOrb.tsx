import React, { useEffect, useState } from 'react';
import { Mic, MicOff, Square, Sparkles, ArrowRight, Radio, PhoneOff, PhoneCall, Volume2 } from 'lucide-react';
import { AgentState, LiveConnectionState } from '../types';

interface VoiceOrbProps {
  agentState: AgentState;
  liveStatus: LiveConnectionState;
  isLiveActive: boolean;
  onToggleLive: () => void;
  onToggleListen: () => void;
  onStopSpeaking: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  liveTranscript: string;
  continuousMode: boolean;
  onToggleContinuous: () => void;
  onQuickPrompt: (text: string) => void;
  activeDocNames: string[];
  inputVolume?: number;
  outputVolume?: number;
}

export const VoiceOrb: React.FC<VoiceOrbProps> = ({
  agentState,
  liveStatus,
  isLiveActive,
  onToggleLive,
  onToggleListen,
  onStopSpeaking,
  isMuted,
  onToggleMute,
  liveTranscript,
  continuousMode,
  onToggleContinuous,
  onQuickPrompt,
  activeDocNames,
  inputVolume = 0,
  outputVolume = 0,
}) => {
  // Wave animation ticks
  const [waveOffset, setWaveOffset] = useState(0);

  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      if (now - lastTime > 40) {
        setWaveOffset((prev) => (prev + 1) % 360);
        lastTime = now;
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  const getStateTag = () => {
    if (liveStatus === 'connecting') {
      return <span className="text-amber-400">Connecting Real-Time Live Session...</span>;
    }
    if (isLiveActive) {
      if (isMuted) return <span className="text-slate-400">Microphone Muted // Tap Mic To Unmute</span>;
      if (agentState === 'speaking') return <span className="text-cyan-300">Natasha Speaking // Live Duplex (Tap to Interrupt)</span>;
      if (agentState === 'listening') return <span className="text-emerald-400">Live Voice Call Active // Speak Freely Anytime</span>;
      return <span className="text-emerald-400">Live Voice Connected // Listening</span>;
    }
    switch (agentState) {
      case 'listening':
        return <span className="text-emerald-400">Listening // Continuous Audio Stream</span>;
      case 'processing':
        return <span className="text-amber-400">Processing Neural Synthesizer...</span>;
      case 'speaking':
        return <span className="text-cyan-300">Speaking // Neural Voice</span>;
      case 'muted':
        return <span className="text-slate-400">Microphone Paused</span>;
      default:
        return <span className="text-emerald-400/90">Tap Orb To Start Real-Time Voice Conversation</span>;
    }
  };

  const getAccentGlow = () => {
    if (isLiveActive) {
      if (agentState === 'speaking') {
        return 'shadow-[inset_0_0_50px_rgba(255,255,255,0.08),0_0_90px_rgba(34,211,238,0.4)] border-cyan-400/60';
      }
      if (isMuted) {
        return 'shadow-[inset_0_0_40px_rgba(255,255,255,0.03),0_0_50px_rgba(100,116,139,0.2)] border-slate-500/40';
      }
      return 'shadow-[inset_0_0_50px_rgba(255,255,255,0.08),0_0_90px_rgba(52,211,153,0.4)] border-emerald-400/60';
    }
    switch (agentState) {
      case 'listening':
        return 'shadow-[inset_0_0_50px_rgba(255,255,255,0.06),0_0_90px_rgba(52,211,153,0.3)] border-emerald-400/40';
      case 'processing':
        return 'shadow-[inset_0_0_50px_rgba(255,255,255,0.06),0_0_90px_rgba(251,191,36,0.3)] border-amber-400/40';
      case 'speaking':
        return 'shadow-[inset_0_0_50px_rgba(255,255,255,0.06),0_0_90px_rgba(34,211,238,0.3)] border-cyan-400/40';
      default:
        return 'shadow-[inset_0_0_50px_rgba(255,255,255,0.03),0_0_70px_rgba(52,211,153,0.15)] border-white/10 hover:border-emerald-400/40';
    }
  };

  // Compute dynamic waveform heights based on actual volume
  const volMultiplier = agentState === 'speaking' ? Math.max(outputVolume * 2.5, 0.2) : Math.max(inputVolume * 3.0, 0.15);
  const barHeights = [
    Math.min(100, Math.max(15, 20 + volMultiplier * 45 + Math.sin(waveOffset * 0.2) * 10)),
    Math.min(100, Math.max(20, 35 + volMultiplier * 60 + Math.cos(waveOffset * 0.25) * 15)),
    Math.min(100, Math.max(25, 55 + volMultiplier * 75 + Math.sin(waveOffset * 0.3) * 18)),
    Math.min(100, Math.max(20, 35 + volMultiplier * 60 + Math.cos(waveOffset * 0.25) * 15)),
    Math.min(100, Math.max(15, 20 + volMultiplier * 45 + Math.sin(waveOffset * 0.2) * 10)),
  ];

  return (
    <div className="flex flex-col items-center justify-center py-4 sm:py-6 px-4 relative">
      {/* Background Soft Aura */}
      <div
        className={`absolute w-[450px] h-[450px] rounded-full blur-[90px] pointer-events-none transition-colors duration-700 ${
          isLiveActive
            ? agentState === 'speaking'
              ? 'bg-cyan-500/15'
              : 'bg-emerald-500/15'
            : 'bg-emerald-500/5'
        }`}
      />

      {/* Mode Pill Indicator */}
      <div className="mb-3">
        {isLiveActive ? (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-xs font-semibold tracking-wider shadow-[0_0_15px_rgba(52,211,153,0.3)]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="uppercase">Real-Time Duplex Voice Active</span>
          </div>
        ) : (
          <button
            onClick={onToggleLive}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-emerald-500/10 border border-white/10 hover:border-emerald-400/40 text-[#E0E2E6] hover:text-emerald-300 text-xs font-semibold tracking-wider transition-all shadow-sm"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span className="uppercase">Switch to Real-Time Voice Call</span>
          </button>
        )}
      </div>

      {/* Interactive Immersive Concentric Ring Orb */}
      <div className="relative flex items-center justify-center my-3">
        {/* Outer Ring */}
        <div
          className={`absolute w-64 h-64 sm:w-72 sm:h-72 rounded-full border border-amber-400/10 transition-all duration-700 ${
            isLiveActive || agentState === 'speaking' || agentState === 'listening'
              ? 'scale-125 opacity-70 animate-pulse'
              : 'scale-110 opacity-30'
          }`}
        />

        {/* Mid Ring */}
        <div
          className={`absolute w-56 h-56 sm:w-64 sm:h-64 rounded-full border border-emerald-400/20 transition-all duration-500 ${
            isLiveActive || agentState === 'listening'
              ? 'scale-115 opacity-90'
              : 'scale-100 opacity-40'
          }`}
        />

        {/* Core Sphere Interactive Trigger */}
        <button
          onClick={() => {
            if (isLiveActive) {
              if (agentState === 'speaking') {
                onStopSpeaking();
              } else {
                onToggleMute();
              }
            } else {
              onToggleLive();
            }
          }}
          className={`relative z-10 w-44 h-44 sm:w-56 sm:h-56 rounded-full bg-gradient-to-br from-[#1E293B] to-[#0F172A] border ${getAccentGlow()} flex flex-col items-center justify-center p-4 transition-all duration-500 transform hover:scale-[1.03] active:scale-95 group overflow-hidden cursor-pointer`}
          title={
            isLiveActive
              ? agentState === 'speaking'
                ? 'Tap to Interrupt Natasha'
                : isMuted
                ? 'Tap to Unmute'
                : 'Tap to Mute Mic'
              : 'Start Real-Time Voice Conversation'
          }
        >
          {/* Bottom subtle ambient gradient flare */}
          <div
            className={`absolute bottom-0 w-full h-24 bg-gradient-to-t ${
              agentState === 'speaking'
                ? 'from-cyan-500/25 to-transparent'
                : agentState === 'processing' || liveStatus === 'connecting'
                ? 'from-amber-500/25 to-transparent'
                : isLiveActive
                ? 'from-emerald-500/25 to-transparent'
                : 'from-emerald-500/15 to-transparent'
            } transition-colors duration-500 pointer-events-none`}
          />

          {/* Realtime Waveform SVG in Center */}
          <div className="relative z-10 flex flex-col items-center justify-center gap-2">
            {liveStatus === 'connecting' || agentState === 'processing' ? (
              <div className="flex flex-col items-center gap-2">
                <Sparkles className="w-10 h-10 text-amber-400 animate-spin" />
                <span className="text-[10px] uppercase tracking-widest text-amber-300 font-mono">
                  {liveStatus === 'connecting' ? 'Connecting Live' : 'Thinking'}
                </span>
              </div>
            ) : agentState === 'speaking' ? (
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-1.5 h-10 mb-1">
                  {barHeights.map((h, i) => (
                    <span
                      key={i}
                      className="w-1.5 bg-cyan-300 rounded-full transition-all duration-75 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                      style={{ height: `${h * 0.45}px` }}
                    />
                  ))}
                </div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-cyan-300/90 flex items-center gap-1 mt-1">
                  <Square className="w-2.5 h-2.5 fill-current" /> Tap to Interrupt
                </span>
              </div>
            ) : isLiveActive ? (
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all ${
                    isMuted
                      ? 'bg-slate-700/50 border-slate-500/40 text-slate-400'
                      : 'bg-emerald-400/20 border-emerald-400/40 text-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.4)] animate-pulse'
                  }`}
                >
                  {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                </div>
                {!isMuted && (
                  <div className="flex items-center gap-1.5 h-4">
                    {barHeights.map((h, i) => (
                      <span
                        key={i}
                        className="w-1 bg-emerald-400 rounded-full transition-all duration-75"
                        style={{ height: `${h * 0.28}px` }}
                      />
                    ))}
                  </div>
                )}
                <span className="text-[9px] uppercase font-bold tracking-widest text-emerald-400/90">
                  {isMuted ? 'Muted' : 'Live Stream'}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <svg viewBox="0 0 100 60" className="w-24 sm:w-28 h-12 text-emerald-400 opacity-80 group-hover:opacity-100 transition-opacity">
                  <path
                    d="M 20 30 Q 35 15, 50 30 T 80 30"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 25 35 Q 40 25, 55 35 T 75 35"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    opacity="0.4"
                  />
                </svg>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#E0E2E6]/90 tracking-widest uppercase">
                  <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Start Live Call</span>
                </div>
              </div>
            )}
          </div>
        </button>
      </div>

      {/* Immersive Spoken Status Display */}
      <div className="mt-2 text-center max-w-lg">
        <p className="text-xs uppercase tracking-[0.3em] font-bold">
          {getStateTag()}
        </p>

        {/* Live Audio Transcript Preview */}
        {liveTranscript && (
          <div className="mt-3 px-5 py-2.5 rounded-2xl bg-white/5 border border-emerald-400/30 backdrop-blur-md text-sm text-emerald-300 font-medium animate-fadeIn shadow-[0_0_20px_rgba(52,211,153,0.15)] inline-block max-w-md text-center">
            "{liveTranscript}"
          </div>
        )}
      </div>

      {/* Real-Time Live Session Controls if Active */}
      {isLiveActive && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={onToggleMute}
            className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wider uppercase transition-all flex items-center gap-2 border ${
              isMuted
                ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                : 'bg-white/5 hover:bg-white/10 text-[#E0E2E6] border-white/10'
            }`}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
            <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
          </button>

          {agentState === 'speaking' && (
            <button
              onClick={onStopSpeaking}
              className="px-4 py-2 rounded-xl text-xs font-semibold tracking-wider uppercase bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/40 transition-all flex items-center gap-2"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Interrupt</span>
            </button>
          )}

          <button
            onClick={onToggleLive}
            className="px-4 py-2 rounded-xl text-xs font-semibold tracking-wider uppercase bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 transition-all flex items-center gap-2"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>End Call</span>
          </button>
        </div>
      )}

      {/* Suggested Spoken Starters */}
      <div className="mt-5 w-full max-w-2xl">
        <div className="flex items-center justify-between text-[11px] tracking-wider uppercase opacity-40 mb-2.5 px-2">
          <span>Suggested Voice Prompts</span>
          {activeDocNames.length > 0 && (
            <span className="text-emerald-400/90 font-mono">
              ● Grounded in {activeDocNames.length} file{activeDocNames.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          {activeDocNames.length > 0 ? (
            <>
              <button
                onClick={() => onQuickPrompt("Summarize what is in my active documents.")}
                className="text-xs bg-white/5 hover:bg-white/10 text-[#E0E2E6] px-3.5 py-2 rounded-xl border border-white/10 hover:border-emerald-400/30 transition-all text-left flex items-center gap-2 backdrop-blur-sm shadow-sm"
              >
                <span>"Summarize my active documents"</span>
                <ArrowRight className="w-3 h-3 text-emerald-400 opacity-60" />
              </button>
              <button
                onClick={() => onQuickPrompt("What are the key technical specifications mentioned in the files?")}
                className="text-xs bg-white/5 hover:bg-white/10 text-[#E0E2E6] px-3.5 py-2 rounded-xl border border-white/10 hover:border-emerald-400/30 transition-all text-left flex items-center gap-2 backdrop-blur-sm shadow-sm"
              >
                <span>"What are key specs in the files?"</span>
                <ArrowRight className="w-3 h-3 text-emerald-400 opacity-60" />
              </button>
              <button
                onClick={() => onQuickPrompt("Are there any limitations or prerequisites noted in the docs?")}
                className="text-xs bg-white/5 hover:bg-white/10 text-[#E0E2E6] px-3.5 py-2 rounded-xl border border-white/10 hover:border-emerald-400/30 transition-all text-left flex items-center gap-2 backdrop-blur-sm shadow-sm"
              >
                <span>"Any limitations noted in the docs?"</span>
                <ArrowRight className="w-3 h-3 text-emerald-400 opacity-60" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onQuickPrompt("Hi Natasha, what can you help me with today?")}
                className="text-xs bg-white/5 hover:bg-white/10 text-[#E0E2E6] px-3.5 py-2 rounded-xl border border-white/10 hover:border-emerald-400/30 transition-all text-left flex items-center gap-2 backdrop-blur-sm shadow-sm"
              >
                <span>"What can you help me with?"</span>
                <ArrowRight className="w-3 h-3 text-emerald-400 opacity-60" />
              </button>
              <button
                onClick={() => onQuickPrompt("नमस्ते नताशा, आप क्या क्या कर सकती हैं?")}
                className="text-xs bg-white/5 hover:bg-white/10 text-[#E0E2E6] px-3.5 py-2 rounded-xl border border-white/10 hover:border-emerald-400/30 transition-all text-left flex items-center gap-2 backdrop-blur-sm shadow-sm"
                title="Hindi: Namaste Natasha"
              >
                <span>"नमस्ते नताशा, आप क्या कर सकती हैं?"</span>
                <ArrowRight className="w-3 h-3 text-emerald-400 opacity-60" />
              </button>
              <button
                onClick={() => onQuickPrompt("নমস্কার নাতাশা, তুমি কেমন আছো?")}
                className="text-xs bg-white/5 hover:bg-white/10 text-[#E0E2E6] px-3.5 py-2 rounded-xl border border-white/10 hover:border-emerald-400/30 transition-all text-left flex items-center gap-2 backdrop-blur-sm shadow-sm"
                title="Bengali: Nomoshkar Natasha"
              >
                <span>"নমস্কার নাতাশা, কেমন আছো?"</span>
                <ArrowRight className="w-3 h-3 text-emerald-400 opacity-60" />
              </button>
              <button
                onClick={() => onQuickPrompt("Hola Natasha, ¿cómo puedes ayudarme hoy?")}
                className="text-xs bg-white/5 hover:bg-white/10 text-[#E0E2E6] px-3.5 py-2 rounded-xl border border-white/10 hover:border-emerald-400/30 transition-all text-left flex items-center gap-2 backdrop-blur-sm shadow-sm"
                title="Spanish: Hola Natasha"
              >
                <span>"Hola Natasha, ¿cómo estás?"</span>
                <ArrowRight className="w-3 h-3 text-emerald-400 opacity-60" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

