import React from 'react';
import { Activity, Bot, User as UserIcon } from 'lucide-react';
import { VoiceEvent } from '../types';

interface ConversationTranscriptProps {
  events: VoiceEvent[];
}

const KIND_META: Record<
  VoiceEvent['kind'],
  { label: string; icon: React.ReactNode; accent: string; border: string; bg: string }
> = {
  user: {
    label: 'USER TRANSCRIPT',
    icon: <UserIcon className="w-3.5 h-3.5" />,
    accent: 'text-emerald-300',
    border: 'border-l-emerald-400/70',
    bg: 'bg-emerald-500/5',
  },
  activity: {
    label: 'MODEL ACTIVITY',
    icon: <Activity className="w-3.5 h-3.5" />,
    accent: 'text-amber-300',
    border: 'border-l-amber-400/70',
    bg: 'bg-amber-500/5',
  },
  assistant: {
    label: 'MODEL RESPONSE',
    icon: <Bot className="w-3.5 h-3.5" />,
    accent: 'text-cyan-300',
    border: 'border-l-cyan-400/70',
    bg: 'bg-cyan-500/5',
  },
};

export const ConversationTranscript: React.FC<ConversationTranscriptProps> = ({ events }) => {
  return (
    <div className="w-full max-w-3xl mx-auto max-h-[min(60vh,520px)] overflow-y-auto space-y-3 py-4 px-2 sm:px-4">
      {events.length === 0 && (
        <div className="text-center text-slate-500 text-sm py-10 tracking-wide">
          Voice transcript will appear here when the live session starts.
        </div>
      )}

      {events.map((event) => {
        const meta = KIND_META[event.kind];
        return (
          <div
            key={event.id}
            className={`border-l-2 ${meta.border} ${meta.bg} pl-4 pr-3 py-3 rounded-r-lg`}
          >
            <div className={`flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase font-semibold ${meta.accent} mb-1.5`}>
              {meta.icon}
              <span>{meta.label}</span>
              {event.tool && (
                <span className="ml-1 font-mono tracking-normal normal-case text-slate-400 opacity-80">
                  · {event.tool}
                </span>
              )}
              {event.status && (
                <span className="ml-auto font-mono tracking-normal normal-case text-[10px] text-slate-500">
                  {event.status}
                </span>
              )}
              <span className="font-mono tracking-normal normal-case text-[10px] text-slate-500 opacity-70">
                {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            <p className="text-sm sm:text-base leading-relaxed text-[#E0E2E6] whitespace-pre-wrap select-text">
              {event.text}
            </p>
          </div>
        );
      })}
    </div>
  );
};
