import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Shield, Cpu, MessageSquare, AlertCircle, Database, ChevronDown, ChevronRight, Trash2, ArrowDown } from 'lucide-react';

export interface DebugLogEvent {
  id: string;
  timestamp: string;
  type: 'INFO' | 'SPEECH_TRANSCRIPTION' | 'DB_INTROSPECTION' | 'TOOL_CALL' | 'GUARDRAIL_CHECK' | 'CONTEXT_PAYLOAD' | 'ERROR';
  source: 'natasha_voice' | 'db_agent' | 'rag_engine' | 'system';
  message: string;
  details?: any;
}

export const DebugLogTerminal: React.FC<{ initialLogs?: DebugLogEvent[] }> = () => {
  const [logs, setLogs] = useState<DebugLogEvent[]>([]);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/db-agent/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.warn('Failed to fetch logs:', err);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredLogs = logs.filter(l => filterType === 'ALL' || l.type === filterType);

  const getTypeBadge = (type: DebugLogEvent['type']) => {
    switch (type) {
      case 'SPEECH_TRANSCRIPTION':
        return <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] px-1.5 py-0.5 rounded font-mono">SPEECH</span>;
      case 'DB_INTROSPECTION':
        return <span className="bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] px-1.5 py-0.5 rounded font-mono">DB_SCHEMA</span>;
      case 'TOOL_CALL':
        return <span className="bg-purple-950 text-purple-300 border border-purple-800 text-[10px] px-1.5 py-0.5 rounded font-mono">TOOL_CALL</span>;
      case 'GUARDRAIL_CHECK':
        return <span className="bg-amber-950 text-amber-300 border border-amber-800 text-[10px] px-1.5 py-0.5 rounded font-mono">GUARDRAIL</span>;
      case 'CONTEXT_PAYLOAD':
        return <span className="bg-blue-950 text-blue-300 border border-blue-800 text-[10px] px-1.5 py-0.5 rounded font-mono">CONTEXT</span>;
      case 'ERROR':
        return <span className="bg-rose-950 text-rose-300 border border-rose-800 text-[10px] px-1.5 py-0.5 rounded font-mono">ERROR</span>;
      default:
        return <span className="bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded font-mono">INFO</span>;
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden text-slate-200 shadow-2xl flex flex-col h-full font-mono text-xs">
      {/* Console Header */}
      <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <h3 className="font-semibold text-slate-100 text-xs tracking-wide">
            Live Voice Agent & db-agent Debug Terminal
          </h3>
          <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full">
            {filteredLogs.length} events
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 text-[10px] rounded border transition flex items-center space-x-1 ${
              autoScroll
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <ArrowDown className="w-3 h-3" />
            <span>Auto-scroll</span>
          </button>
          <button
            onClick={() => setLogs([])}
            className="text-slate-400 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition"
            title="Clear Terminal Logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter Tabs Bar */}
      <div className="flex flex-wrap gap-1.5 p-2 bg-slate-900/60 border-b border-slate-800/80 text-[11px]">
        {['ALL', 'SPEECH_TRANSCRIPTION', 'DB_INTROSPECTION', 'TOOL_CALL', 'GUARDRAIL_CHECK', 'CONTEXT_PAYLOAD', 'ERROR'].map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-2 py-0.5 rounded transition text-[10px] font-semibold ${
              filterType === t
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Logs Output List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-950">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-600 text-center py-12 text-xs italic">
            No debug log events recorded yet. Speak to Natasha or run a tool call to stream logs live.
          </div>
        ) : (
          filteredLogs.map(log => {
            const isExpanded = expandedIds[log.id];
            return (
              <div
                key={log.id}
                className="bg-slate-900/70 border border-slate-800/80 rounded p-2 hover:border-slate-700 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span className="text-slate-500 text-[10px]">{log.timestamp.split('T')[1]?.slice(0, 8)}</span>
                    {getTypeBadge(log.type)}
                    <span className="text-slate-400 text-[10px] font-bold">[{log.source}]</span>
                    <span className="text-slate-200">{log.message}</span>
                  </div>
                  {log.details && (
                    <button
                      onClick={() => toggleExpand(log.id)}
                      className="text-slate-400 hover:text-slate-200 p-0.5"
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>

                {/* Expanded Details JSON Payload */}
                {isExpanded && log.details && (
                  <div className="mt-2 p-2 bg-slate-950 rounded border border-slate-800 text-[11px] text-emerald-400 overflow-x-auto">
                    <pre>{JSON.stringify(log.details, null, 2)}</pre>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
};
