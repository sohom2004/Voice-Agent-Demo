import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { VoiceOrb } from './components/VoiceOrb';
import { ConversationTranscript } from './components/ConversationTranscript';
import { VoiceInputBar } from './components/VoiceInputBar';
import { DocumentDrawer } from './components/DocumentDrawer';
import { VoiceSettingsModal } from './components/VoiceSettingsModal';
import { DbColumnInspector } from './components/DbColumnInspector';
import { DebugLogTerminal } from './components/DebugLogTerminal';
import { SAMPLE_DOCUMENTS } from './data/sampleDocs';
import { Message, DocumentFile, AgentState, VoiceSettings, VoiceName, LiveConnectionState } from './types';
import { 
  playPcmAudio, 
  stopCurrentAudio, 
  speakWithBrowser, 
  createSpeechRecognizer, 
  SpeechRecognitionController 
} from './utils/audioEngine';
import { LiveAudioClient } from './utils/liveAudioClient';
import { LayoutDashboard, MessageSquare, Database, Terminal, Shield } from 'lucide-react';

const INITIAL_GREETING = "Hi there! I'm Natasha. I'm connected with db-agent and ready to converse in real time. Ask me about your database, tables, columns, or uploaded documents!";

export default function App() {
  // Main View Switcher: 'dashboard' (Live DB Context & Logs) or 'chat' (Transcript)
  const [activeView, setActiveView] = useState<'dashboard' | 'chat'>('dashboard');

  // Conversation History
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-greeting',
      role: 'assistant',
      content: INITIAL_GREETING,
      timestamp: Date.now(),
      suggestedQuestions: [
        'What tables and columns exist in my database?',
        'Can you count how many records are in the database?',
        'Show me the recent orders in the system.'
      ]
    }
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
            type: d.fileType || d.type,
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
      doc => doc.status === 'uploaded' || doc.status === 'processing'
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
                type: d.fileType || d.type,
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
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Settings
  const [settings, setSettings] = useState<VoiceSettings>({
    selectedVoice: 'Kore',
    speechRate: 1.0,
    pitch: 1.0,
    continuousMode: false,
    theme: 'dark'
  });

  const recognizerRef = useRef<SpeechRecognitionController | null>(null);
  const liveClientRef = useRef<LiveAudioClient | null>(null);
  const isListeningRef = useRef(false);
  const lastSpokenUserUtterance = useRef<string>('');

  const activeDocNames = documents.filter((d) => d.enabled).map((d) => d.name);

  // Initialize Live Audio Client
  useEffect(() => {
    const client = new LiveAudioClient({
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
      },
      onModelTranscript: (text) => {
        setLiveTranscript(`Natasha: ${text}`);
        setAgentState('speaking');
      },
      onModelTurnComplete: (fullText) => {
        setLiveTranscript('');
        setAgentState('idle');

        const now = Date.now();
        const newMsgs: Message[] = [];

        if (lastSpokenUserUtterance.current.trim()) {
          newMsgs.push({
            id: 'msg_user_' + now,
            role: 'user',
            content: lastSpokenUserUtterance.current.trim(),
            timestamp: now - 500,
          });
          lastSpokenUserUtterance.current = '';
        }

        if (fullText.trim()) {
          newMsgs.push({
            id: 'msg_natasha_' + (now + 1),
            role: 'assistant',
            content: fullText.trim(),
            timestamp: now,
          });
        }

        if (newMsgs.length > 0) {
          setMessages((prev) => [...prev, ...newMsgs]);
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

  // Play assistant voice
  const handlePlayVoice = useCallback(async (msg: Message, rate = settings.speechRate) => {
    stopCurrentAudio();
    setActivePlayingId(msg.id);
    setIsPlayingAudio(true);
    setAgentState('speaking');

    const onAudioEnd = () => {
      setIsPlayingAudio(false);
      setActivePlayingId(null);
      setAgentState('idle');
    };

    if (msg.audioBase64) {
      try {
        await playPcmAudio(msg.audioBase64, onAudioEnd, rate);
        return;
      } catch (err) {
        console.warn('PCM playback failed:', err);
      }
    }

    if (settings.selectedVoice === 'browser') {
      speakWithBrowser(msg.content, settings.selectedVoice, rate, settings.pitch, undefined, onAudioEnd);
    } else {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: msg.content, voiceName: settings.selectedVoice })
        });
        const data = await res.json();
        if (data.audioBase64) {
          msg.audioBase64 = data.audioBase64;
          await playPcmAudio(data.audioBase64, onAudioEnd, rate);
        } else {
          speakWithBrowser(msg.content, settings.selectedVoice, rate, settings.pitch, undefined, onAudioEnd);
        }
      } catch {
        speakWithBrowser(msg.content, settings.selectedVoice, rate, settings.pitch, undefined, onAudioEnd);
      }
    }
  }, [settings]);

  // Toggle Live Duplex Session
  const handleToggleLive = async () => {
    if (liveStatus === 'connected' || liveStatus === 'connecting') {
      liveClientRef.current?.stop();
      setLiveStatus('disconnected');
      setAgentState('idle');
      setLiveTranscript('');
      setIsMuted(false);
    } else {
      stopCurrentAudio();
      recognizerRef.current?.stop();
      isListeningRef.current = false;
      setIsPlayingAudio(false);
      setActivePlayingId(null);

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

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    if (liveStatus === 'connected' && liveClientRef.current) {
      liveClientRef.current.sendText(text.trim());
      lastSpokenUserUtterance.current = text.trim();
      setLiveTranscript(`You: ${text.trim()}`);
      return;
    }

    stopCurrentAudio();
    setIsPlayingAudio(false);
    setActivePlayingId(null);

    const userMsg: Message = {
      id: 'msg_user_' + Date.now(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setAgentState('processing');

    try {
      const activeDocIds = documents.filter((d) => d.enabled).map((d) => d.id);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          workspaceId: 'default_workspace',
          documentIds: activeDocIds,
          selectedVoice: settings.selectedVoice,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg: Message = {
        id: 'msg_assistant_' + Date.now(),
        role: 'assistant',
        content: data.text,
        timestamp: Date.now(),
        audioBase64: data.audioBase64,
        suggestedQuestions: data.suggestedQuestions,
        groundedDocuments: data.groundedDocs,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setAgentState('idle');
      handlePlayVoice(assistantMsg);
    } catch (err: any) {
      console.error('Chat error:', err);
      setAgentState('idle');
      const errMsgs: Message = {
        id: 'msg_err_' + Date.now(),
        role: 'assistant',
        content: "Sorry, I hit an issue connecting. Please try again.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsgs]);
    }
  };

  const handleStopSpeaking = () => {
    stopCurrentAudio();
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      isListeningRef.current = false;
    }
    setIsPlayingAudio(false);
    setActivePlayingId(null);
    setAgentState('idle');
  };

  const handleToggleListen = () => {
    if (agentState === 'listening') {
      handleStopSpeaking();
    }
  };

  const handleNewSession = () => {
    stopCurrentAudio();
    setMessages([
      {
        id: 'init-greeting-' + Date.now(),
        role: 'assistant',
        content: INITIAL_GREETING,
        timestamp: Date.now(),
        suggestedQuestions: [
          'What tables and columns exist in my database?',
          'Can you count how many records are in the database?',
          'Show me the recent orders in the system.'
        ]
      }
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
          type: d.fileType || d.type,
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
            <button
              onClick={() => setActiveView('chat')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeView === 'chat'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Conversation Transcript View</span>
            </button>
          </div>
          <div className="text-xs text-slate-400 font-mono hidden md:flex items-center space-x-2 px-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>db-agent Manifest Active</span>
          </div>
        </div>

        {/* Hero Interactive Voice Orb */}
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
            onQuickPrompt={handleSendMessage}
            activeDocNames={activeDocNames}
            inputVolume={inputVolume}
            outputVolume={outputVolume}
          />
        </section>

        {/* View Mode 1: Live Voice Agent Debug & Database Column Inspector Dashboard */}
        {activeView === 'dashboard' && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[550px]">
            {/* Left Column: Database Column Context Inspector */}
            <div className="h-[550px]">
              <DbColumnInspector tenantId="default_tenant" />
            </div>

            {/* Right Column: Live Debug & Log Terminal Stream */}
            <div className="h-[550px]">
              <DebugLogTerminal />
            </div>
          </section>
        )}

        {/* View Mode 2: Standard Conversation Transcript */}
        {activeView === 'chat' && (
          <section aria-label="Conversation Transcript" className="flex-1 my-2">
            <div className="border-t border-white/10 pt-4">
              <ConversationTranscript
                messages={messages}
                activePlayingId={activePlayingId}
                isPlayingAudio={isPlayingAudio}
                onPlayAudio={handlePlayVoice}
                onStopAudio={handleStopSpeaking}
                onAskSuggested={handleSendMessage}
                speechRate={settings.speechRate}
              />
            </div>
          </section>
        )}
      </main>

      {/* Sticky Input Bar */}
      <VoiceInputBar
        agentState={agentState}
        isLiveActive={liveStatus === 'connected'}
        onSendMessage={handleSendMessage}
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
        onAskQuestion={handleSendMessage}
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
