import React from 'react';
import { X, Volume2, Mic, Play, Sparkles, Check, Settings2, Sliders, Radio } from 'lucide-react';
import { VoiceName, VoiceSettings } from '../types';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: VoiceSettings;
  onUpdateSettings: (newSettings: Partial<VoiceSettings>) => void;
  onTestVoice: (voice: VoiceName, rate: number) => void;
  isTestingVoice: boolean;
}

const VOICES: Array<{ id: VoiceName; name: string; desc: string; tag: string }> = [
  { id: 'Kore', name: 'Kore (Recommended)', desc: 'Warm, natural, clear and approachable female tone. Perfect for Natasha.', tag: 'Neural' },
  { id: 'Aoede', name: 'Aoede', desc: 'Expressive, articulate and sophisticated.', tag: 'Neural' },
  { id: 'Zephyr', name: 'Zephyr', desc: 'Bright, energetic, upbeat cadence.', tag: 'Neural' },
  { id: 'Puck', name: 'Puck', desc: 'Youthful, dynamic, friendly companion style.', tag: 'Neural' },
  { id: 'Fenrir', name: 'Fenrir', desc: 'Deep, calm, resonant and authoritative.', tag: 'Neural' },
  { id: 'Charon', name: 'Charon', desc: 'Smooth, measured, relaxed tone.', tag: 'Neural' },
  { id: 'browser', name: 'Browser Local TTS', desc: 'Instant zero-latency synthesis using local device voices.', tag: 'Offline' },
];

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onTestVoice,
  isTestingVoice,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-[#0c0e12] border border-white/10 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-6 text-[#E0E2E6] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-emerald-400">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider uppercase text-white">Voice & Dialogue Settings</h2>
              <p className="text-xs opacity-50">Customize Natasha's speech synthesis and conversation cadence</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[#E0E2E6]/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Voice Selection */}
        <div className="space-y-3">
          <label className="text-[10px] uppercase tracking-[0.2em] font-semibold opacity-50 flex items-center justify-between">
            <span>Natasha Voice Model</span>
            <button
              onClick={() => onTestVoice(settings.selectedVoice, settings.speechRate)}
              disabled={isTestingVoice}
              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-semibold normal-case"
            >
              <Play className="w-3 h-3 fill-current" />
              {isTestingVoice ? 'Testing Voice...' : 'Preview Voice'}
            </button>
          </label>

          <div className="grid grid-cols-1 gap-2">
            {VOICES.map((v) => {
              const isSelected = settings.selectedVoice === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => onUpdateSettings({ selectedVoice: v.id })}
                  className={`flex items-start justify-between p-3.5 rounded-2xl border text-left transition-all relative ${
                    isSelected
                      ? 'bg-emerald-500/10 border-emerald-400/50 shadow-[0_0_15px_rgba(52,211,153,0.15)] text-white'
                      : 'bg-white/[0.02] border-white/5 hover:border-white/15 opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{v.name}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                          v.tag === 'Neural'
                            ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                            : 'bg-white/10 text-slate-400'
                        }`}
                      >
                        {v.tag}
                      </span>
                    </div>
                    <p className="text-xs opacity-60 mt-1">{v.desc}</p>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-emerald-400 flex items-center justify-center text-slate-950 mt-0.5 flex-shrink-0 font-bold shadow-[0_0_10px_#34d399]">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Speed Slider */}
        <div className="space-y-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold opacity-80">Speech Rate</span>
            <span className="font-mono text-emerald-400 font-bold">{settings.speechRate.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.8"
            max="1.4"
            step="0.05"
            value={settings.speechRate}
            onChange={(e) => onUpdateSettings({ speechRate: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
          <div className="flex justify-between text-[10px] opacity-40">
            <span>Slower (0.8x)</span>
            <span>Default (1.0x)</span>
            <span>Faster (1.4x)</span>
          </div>
        </div>

        {/* Behavior Toggles */}
        <div className="space-y-3 pt-2 border-t border-white/10">
          <span className="text-[10px] uppercase tracking-[0.2em] font-semibold opacity-50 block">
            Interactive Behavior
          </span>

          {/* Auto-Speak Responses */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] border border-white/5">
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-emerald-400" />
                <span>Auto-Read Answers Aloud</span>
              </div>
              <p className="text-xs opacity-50">
                Immediately synthesize and play voice audio when Natasha replies
              </p>
            </div>
            <button
              onClick={() => onUpdateSettings({ autoSpeak: !settings.autoSpeak })}
              className={`w-12 h-6 rounded-full transition-colors relative flex items-center px-1 ${
                settings.autoSpeak ? 'bg-emerald-400' : 'bg-white/10'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${
                  settings.autoSpeak ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Hands-Free Continuous Mode */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.02] border border-white/5">
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-emerald-400" />
                <span>Hands-Free Auto-Listen Loop</span>
              </div>
              <p className="text-xs opacity-50">
                Automatically reactivate the microphone after Natasha finishes speaking
              </p>
            </div>
            <button
              onClick={() => onUpdateSettings({ continuousMode: !settings.continuousMode })}
              className={`w-12 h-6 rounded-full transition-colors relative flex items-center px-1 ${
                settings.continuousMode ? 'bg-emerald-400' : 'bg-white/10'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-slate-950 transition-transform ${
                  settings.continuousMode ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-xs font-bold bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-[0_0_15px_rgba(52,211,153,0.4)] transition-all"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};
