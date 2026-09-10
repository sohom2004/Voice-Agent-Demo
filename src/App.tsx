import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { VoiceOrb } from './components/VoiceOrb';
import { ConversationTranscript } from './components/ConversationTranscript';
import { VoiceInputBar } from './components/VoiceInputBar';
import { DocumentDrawer } from './components/DocumentDrawer';
import { VoiceSettingsModal } from './components/VoiceSettingsModal';
import { DbColumnInspector } from './components/DbColumnInspector';
import { DebugLogTerminal } from './components/DebugLogTerminal';
import { DocumentFile, AgentState, VoiceSettings, VoiceName, LiveConnectionState, VoiceEvent } from './types';
import { 
  playPcmAudio, 
  stopCurrentAudio, 
  speakWithBrowser, 
  SpeechRecognitionController 
} from './utils/audioEngine';
import { LiveKitClient } from './utils/liveKitClient';
import { LayoutDashboard, Radio } from 'lucide-react';

const INITIAL_GREETING = "Hi, I'm Natasha with medical billing support. I can help with claims, invoices, payments, and support tickets.";

function makeVoiceEvent(
  kind: VoiceEvent['kind'],
  text: string,
  extra?: Partial<Pick<VoiceEvent, 'status' | 'tool' | 'id' | 'timestamp'>>
): VoiceEvent {
  return {
    id: extra?.id ?? `ve_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind,
    text,
    timestamp: extra?.timestamp ?? Date.now(),
    status: extra?.status,
    tool: extra?.tool,
  };
}

export default function App() {
  // Main View Switcher: 'voice' (realtime transcript) or 'dashboard' (DB + logs)
  const [activeView, setActiveView] = useState<'dashboard' | 'voice'>('voice');

  // Realtime voice event feed (user / activity / assistant)
  const [voiceEvents, setVoiceEvents] = useState<VoiceEvent[]>([
    makeVoiceEvent('assistant', INITIAL_GREETING, { id: 'init-greeting' }),
  ]);

  // Documents
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [isDocsDrawerOpen, setIsDocsDrawerOpen] = useState(false);

  // Load documents on mount
  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch('/api/documents?workspaceId=default_workspace');
        if (res.ok) {
          const data = await res.json();
          setDocuments(data.map((d: any) => ({
            ...d,
            type: d.fileType || d.file_type || d.type || 'txt',
            enabled: true
          })));
        }
      } catch (err) {
        console.error('Failed to fetch documents on mount:', err);
      }
    };
    fetchDocs();
  }, []);

  // Poll documents if any are processing
  useEffect(() => {
    const hasUnfinished = documents.some(
      doc => doc.status === 'uploaded' || doc.status === 'processing' || doc.status === 'embedding'
    );
    if (!hasUnfinished) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/documents?workspaceId=default_workspace');
        if (res.ok) {
          const data = await res.json();
          setDocuments(prev => {
            return data.map((d: any) => {
              const existing = prev.find(p => p.id === d.id);
              return {
                ...d,
                type: d.fileType || d.file_type || d.type || 'txt',
                enabled: existing ? existing.enabled : true
              };
            });
          });
        }
      } catch (err) {
        console.warn('Document status polling failed:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [documents]);

  // Agent State & Speech
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [liveStatus, setLiveStatus] = useState<LiveConnectionState>('disconnected');
  const [isMuted, setIsMuted] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [inputVolume, setInputVolume] = useState(0);
  const [outputVolume, setOutputVolume] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);

  // Settings
  const [settings, setSettings] = useState<VoiceSettings>({
    selectedVoice: 'Kore',
    speechRate: 1.0,
    pitch: 1.0,
    continuousMode: false,
    theme: 'dark'
  });

  const recognizerRef = useRef<SpeechRecognitionController | null>(null);
  const liveClientRef = useRef<LiveKitClient | null>(null);
  const isListeningRef = useRef(false);
  const lastSpokenUserUtterance = useRef<string>('');
  const openUserEventIdRef = useRef<string | null>(null);

  const activeDocNames = documents.filter((d) => d.enabled).map((d) => d.name);

  // Initialize Live Audio Client
  useEffect(() => {
    const client = new LiveKitClient({
      onStatusChange: (status) => {
        setLiveStatus(status);
        if (status === 'connected') {
          setAgentState('idle');
        } else if (status === 'connecting') {
          setAgentState('processing');
        } else {
          setAgentState('idle');
        }
      },
      onUserTranscript: (text) => {
        lastSpokenUserUtterance.current = text;
        setLiveTranscript(`You: ${text}`);
        setAgentState('listening');

        setVoiceEvents((prev) => {
          const openId = openUserEventIdRef.current;
          if (openId) {
            const idx = prev.findIndex((e) => e.id === openId && e.kind === 'user');
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], text, timestamp: Date.now() };
              return next;
            }
          }
          const ev = makeVoiceEvent('user', text);
          openUserEventIdRef.current = ev.id;
          return [...prev, ev];
        });
      },
      onModelTranscript: (text) => {
        setLiveTranscript(`Natasha: ${text}`);
        setAgentState('speaking');
      },
      onModelActivity: (payload) => {
        const text = (payload.text || payload.tool || 'Model activity').trim();
        if (!text) return;
        const status = payload.phase || payload.status;
        setVoiceEvents((prev) => [
          ...prev,
          makeVoiceEvent('activity', text, {
            status: status || undefined,
            tool: payload.tool,
          }),
        ]);
      },
      onModelTurnComplete: (fullText) => {
        setLiveTranscript('');
        setAgentState('idle');
        openUserEventIdRef.current = null;

        const now = Date.now();

        // Ensure latest user utterance is recorded if we somehow missed streaming updates
        if (lastSpokenUserUtterance.current.trim()) {
          const userText = lastSpokenUserUtterance.current.trim();
          lastSpokenUserUtterance.current = '';
          setVoiceEvents((prev) => {
            const lastUser = [...prev].reverse().find((e) => e.kind === 'user');
            if (lastUser && lastUser.text === userText) return prev;
            return [...prev, makeVoiceEvent('user', userText, { timestamp: now - 500 })];
          });
        }

        if (fullText.trim()) {
          setVoiceEvents((prev) => [
            ...prev,
            makeVoiceEvent('assistant', fullText.trim(), { timestamp: now }),
          ]);
        }
      },
      onVolumeChange: (inVol, outVol) => {
        setInputVolume(inVol);
        setOutputVolume(outVol);
      },
      onError: (err) => {
        console.warn('[Live] Client reported error:', err);
        setLiveTranscript(`Error: ${err}`);
      },
    });

    liveClientRef.current = client;

    return () => {
      stopCurrentAudio();
      client.stop();
      recognizerRef.current?.abort();
    };
  }, []);

  // Toggle Live Duplex Session
  const handleToggleLive = async () => {
    if (liveStatus === 'connected' || liveStatus === 'connecting') {
      liveClientRef.current?.stop();
      setLiveStatus('disconnected');
      setAgentState('idle');
      setLiveTranscript('');
      setIsMuted(false);
      openUserEventIdRef.current = null;
    } else {
      stopCurrentAudio();
      recognizerRef.current?.stop();
      isListeningRef.current = false;

      try {
        await liveClientRef.current?.start(settings.selectedVoice, documents);
      } catch (err) {
        console.error('Failed to start live session:', err);
      }
    }
  };

  const handleToggleMute = () => {
    if (liveClientRef.current && liveStatus === 'connected') {
      const muted = liveClientRef.current.toggleMute();
      setIsMuted(muted);
    }
  };

  const handleStopSpeaking = () => {
    stopCurrentAudio();
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      isListeningRef.current = false;
    }
    setAgentState('idle');
  };

  const handleToggleListen = () => {
    if (agentState === 'listening') {
      handleStopSpeaking();
    }
  };

  const handleNewSession = () => {
    stopCurrentAudio();
    openUserEventIdRef.current = null;
    lastSpokenUserUtterance.current = '';
    setVoiceEvents([
      makeVoiceEvent('assistant', INITIAL_GREETING, { id: 'init-greeting-' + Date.now() }),
    ]);
  };

  const handleToggleDocument = (id: string) => {
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d));
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      setDocuments(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  const handleAddDocuments = (newDocs: DocumentFile[]) => {
    setDocuments(prev => [...prev, ...newDocs]);
  };

  const handleResetSamples = async () => {
    try {
      setDocuments([]);
      const res = await fetch('/api/documents/reset-samples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'default_workspace' })
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.map((d: any) => ({
          ...d,
          type: d.fileType || d.file_type || d.type || 'txt',
          enabled: true
        })));
      }
    } catch (err) {
      console.error('Failed to reset sample documents:', err);
    }
  };

  const handleTestVoice = async (voice: VoiceName, rate: number) => {
    setIsTestingVoice(true);
    const testText = "Hi! I'm Natasha. This is how my voice sounds at this setting.";
    const onDone = () => setIsTestingVoice(false);

    if (voice === 'browser') {
      speakWithBrowser(testText, voice, rate, 1.0, undefined, onDone);
    } else {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: testText, voiceName: voice })
        });
        const data = await res.json();
        if (data.audioBase64) {
          await playPcmAudio(data.audioBase64, onDone, rate);
        } else {
          speakWithBrowser(testText, voice, rate, 1.0, undefined, onDone);
        }
      } catch {
        speakWithBrowser(testText, voice, rate, 1.0, undefined, onDone);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#050608] text-[#E0E2E6] flex flex-col selection:bg-emerald-400 selection:text-slate-950 font-sans relative overflow-x-hidden">
      {/* Background Glow Orbs */}
      <div 
        className="fixed inset-0 pointer-events-none z-0" 
        style={{ background: 'radial-gradient(circle at 50% 35%, #151821 0%, #050608 100%)', opacity: 0.85 }} 
      />
      <div className="fixed top-[-100px] left-[-100px] w-[500px] h-[500px] bg-emerald-500/10 blur-[140px] rounded-full pointer-events-none z-0" />
      <div className="fixed bottom-[-100px] right-[-100px] w-[550px] h-[550px] bg-cyan-500/10 blur-[160px] rounded-full pointer-events-none z-0" />

      {/* Header */}
      <Header
        agentState={agentState}
        liveStatus={liveStatus}
        isLiveActive={liveStatus === 'connected'}
        onToggleLive={handleToggleLive}
        activeDocsCount={documents.filter(d => d.enabled).length}
        totalDocsCount={documents.length}
        onToggleDocs={() => setIsDocsDrawerOpen(true)}
        onToggleSettings={() => setIsSettingsOpen(true)}
        onNewSession={handleNewSession}
        continuousMode={settings.continuousMode}
        onToggleContinuous={() => setSettings(s => ({ ...s, continuousMode: !s.continuousMode }))}
      />

      {/* Main Container */}
      <main className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-3 sm:px-6 relative z-10 py-4">
        
        {/* View Selector Switcher Bar */}
        <div className="flex items-center justify-between mb-4 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveView('voice')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeView === 'voice'
                  ? 'bg-gradient-to-r from-cyan-600 to-emerald-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Radio className="w-4 h-4" />
              <span>Voice Agent</span>
            </button>
            <button
              onClick={() => setActiveView('dashboard')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeView === 'dashboard'
                  ? 'bg-gradient-to-r from-cyan-600 to-emerald-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Live DB Column Context & Debug Dashboard</span>
            </button>
          </div>
          <div className="text-xs text-slate-400 font-mono hidden md:flex items-center space-x-2 px-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>sql-mcp + LiveKit Active</span>
          </div>
        </div>

        {/* Hero Interactive Voice Orb — always visible */}
        <section aria-label="Natasha Voice Control" className="w-full mb-4">
          <VoiceOrb
            agentState={agentState}
            liveStatus={liveStatus}
            isLiveActive={liveStatus === 'connected'}
            onToggleLive={handleToggleLive}
            onToggleListen={handleToggleListen}
            onStopSpeaking={handleStopSpeaking}
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
            liveTranscript={liveTranscript}
            continuousMode={settings.continuousMode}
            onToggleContinuous={() => setSettings(s => ({ ...s, continuousMode: !s.continuousMode }))}
            activeDocNames={activeDocNames}
            inputVolume={inputVolume}
            outputVolume={outputVolume}
          />
        </section>

        {/* Primary: Realtime voice event feed */}
        {activeView === 'voice' && (
          <section aria-label="Voice Transcript" className="flex-1 my-2">
            <div className="border-t border-white/10 pt-4">
              <ConversationTranscript events={voiceEvents} />
            </div>
          </section>
        )}

        {/* Dashboard: DB inspector + debug logs */}
        {activeView === 'dashboard' && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[550px]">
            <div className="h-[550px]">
              <DbColumnInspector tenantId="default_tenant" />
            </div>
            <div className="h-[550px]">
              <DebugLogTerminal />
            </div>
          </section>
        )}
      </main>

      {/* Sticky Voice Control Strip */}
      <VoiceInputBar
        agentState={agentState}
        isLiveActive={liveStatus === 'connected'}
        onToggleListen={handleToggleListen}
        onToggleLive={handleToggleLive}
        onStopSpeaking={handleStopSpeaking}
        onOpenDocs={() => setIsDocsDrawerOpen(true)}
        isProcessing={agentState === 'processing' || liveStatus === 'connecting'}
      />

      {/* Document Drawer */}
      <DocumentDrawer
        isOpen={isDocsDrawerOpen}
        onClose={() => setIsDocsDrawerOpen(false)}
        documents={documents}
        onToggleDocument={handleToggleDocument}
        onDeleteDocument={handleDeleteDocument}
        onAddDocuments={handleAddDocuments}
        onResetSamples={handleResetSamples}
      />

      {/* Settings Modal */}
      <VoiceSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={(newVals) => setSettings(s => ({ ...s, ...newVals }))}
        onTestVoice={handleTestVoice}
        isTestingVoice={isTestingVoice}
      />
    </div>
  );
}
