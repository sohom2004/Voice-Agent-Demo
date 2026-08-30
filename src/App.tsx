import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { VoiceOrb } from './components/VoiceOrb';
import { ConversationTranscript } from './components/ConversationTranscript';
import { VoiceInputBar } from './components/VoiceInputBar';
import { DocumentDrawer } from './components/DocumentDrawer';
import { VoiceSettingsModal } from './components/VoiceSettingsModal';
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

const INITIAL_GREETING = "Hi there! I'm Natasha. I'm connected and ready to converse in real time. Feel free to talk or ask about your files anytime!";

export default function App() {
  // Conversation History
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init-greeting',
      role: 'assistant',
      content: INITIAL_GREETING,
      timestamp: Date.now(),
      suggestedQuestions: [
        'What documents do you have in your knowledge base?',
        'Can you summarize the Aurora architecture notes?',
        'Tell me what makes your voice interaction unique.'
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
          // Initially, enable everything retrieved
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
            // Merge status changes but keep the client-side enabled state
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
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Settings
  const [settings, setSettings] = useState<VoiceSettings>({
    selectedVoice: 'Kore',
    speechRate: 1.0,
    pitch: 1.0,
    autoSpeak: true,
    continuousMode: false,
    useGeminiTTS: true,
    liveModeEnabled: true,
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);

  // Live Audio Client Ref & Speech Recognition ref
  const liveClientRef = useRef<LiveAudioClient | null>(null);
  const recognizerRef = useRef<SpeechRecognitionController | null>(null);
  const isListeningRef = useRef(false);
  const lastSpokenUserUtterance = useRef('');

  // Active Document names
  const activeDocNames = documents.filter(d => d.enabled).map(d => d.name);

  // Initialize LiveAudioClient instance
  useEffect(() => {
    const client = new LiveAudioClient({
      onStatusChange: (status) => {
        setLiveStatus(status);
        if (status === 'disconnected') {
          setInputVolume(0);
          setOutputVolume(0);
        }
      },
      onAgentStateChange: (state) => {
        setAgentState(state);
      },
      onUserTranscript: (transcript) => {
        lastSpokenUserUtterance.current = transcript;
        setLiveTranscript(`You: ${transcript}`);
      },
      onModelTranscript: (transcript) => {
        setLiveTranscript(`Natasha: ${transcript}`);
      },
      onModelTurnComplete: (fullText) => {
        setLiveTranscript('');
        // Append completed turn to conversation messages
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

  // Play assistant voice (for turn-based messages)
  const handlePlayVoice = useCallback(async (msg: Message, rate = settings.speechRate) => {
    stopCurrentAudio();
    setActivePlayingId(msg.id);
    setIsPlayingAudio(true);
    setAgentState('speaking');

    const onAudioEnd = () => {
      setIsPlayingAudio(false);
      setActivePlayingId(null);
      setAgentState('idle');

      // If continuous hands-free mode is on, auto-listen
      if (settings.continuousMode && liveStatus !== 'connected') {
        setTimeout(() => {
          startListening();
        }, 400);
      }
    };

    // If we already have Gemini TTS audio cached
    if (msg.audioBase64) {
      try {
        await playPcmAudio(msg.audioBase64, onAudioEnd, rate);
        return;
      } catch (err) {
        console.warn('PCM playback failed, falling back to browser TTS:', err);
      }
    }

    // Otherwise, fetch TTS or use Browser Speech
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
  }, [settings, liveStatus]);

  // Toggle Live Duplex Call Session
  const handleToggleLive = async () => {
    if (liveStatus === 'connected' || liveStatus === 'connecting') {
      // Stop live session
      liveClientRef.current?.stop();
      setLiveStatus('disconnected');
      setAgentState('idle');
      setLiveTranscript('');
      setIsMuted(false);
    } else {
      // Stop any turn-based playback / listeners
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

  // Toggle Mute in Live Call
  const handleToggleMute = () => {
    if (liveClientRef.current && liveStatus === 'connected') {
      const muted = liveClientRef.current.toggleMute();
      setIsMuted(muted);
    } else if (agentState === 'listening') {
      stopListening();
    } else {
      startListening();
    }
  };

  // Send message to Natasha
  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    // If Live Real-Time session is connected, send text directly over the live stream
    if (liveStatus === 'connected' && liveClientRef.current) {
      liveClientRef.current.sendText(text.trim());
      lastSpokenUserUtterance.current = text.trim();
      setLiveTranscript(`You: ${text.trim()}`);
      return;
    }

    // Stop ongoing audio
    stopCurrentAudio();
    setIsPlayingAudio(false);
    setActivePlayingId(null);

    // Stop listening if active
    if (isListeningRef.current) {
      recognizerRef.current?.stop();
      isListeningRef.current = false;
    }

    const userMessage: Message = {
      id: 'msg_' + Date.now(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setLiveTranscript('');
    setAgentState('processing');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          history: newHistory.slice(-10),
          activeDocumentIds: documents.filter(d => d.enabled).map(d => d.id),
          workspaceId: 'default_workspace',
          voiceName: settings.selectedVoice,
          generateAudio: settings.autoSpeak && settings.selectedVoice !== 'browser',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to connect to Natasha');
      }

      const assistantMessage: Message = {
        id: 'msg_natasha_' + Date.now(),
        role: 'assistant',
        content: data.text,
        timestamp: Date.now(),
        audioBase64: data.audioBase64,
        groundedDocuments: data.groundedDocs,
        suggestedQuestions: data.suggestedQuestions || [],
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (settings.autoSpeak) {
        handlePlayVoice(assistantMessage, settings.speechRate);
      } else {
        setAgentState('idle');
      }
    } catch (err: unknown) {
      console.error('Error talking to Natasha:', err);
      const errMsg = err instanceof Error ? err.message : 'Connection error';
      const errorMessage: Message = {
        id: 'msg_err_' + Date.now(),
        role: 'assistant',
        content: `I ran into a small hiccup connecting to the server: ${errMsg}. Please feel free to try again!`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setAgentState('idle');
    }
  };

  // Start Speech Recognition (for turn-based mode)
  const startListening = () => {
    stopCurrentAudio();
    setIsPlayingAudio(false);
    setActivePlayingId(null);

    const recognizer = createSpeechRecognizer(
      (transcript, isFinal) => {
        setLiveTranscript(transcript);
        if (isFinal && transcript.trim().length > 1) {
          recognizer.stop();
          isListeningRef.current = false;
          handleSendMessage(transcript);
        }
      },
      () => {
        setAgentState('listening');
        isListeningRef.current = true;
      },
      () => {
        if (isListeningRef.current) {
          setAgentState('idle');
          isListeningRef.current = false;
        }
      },
      (err) => {
        console.warn('Speech recognition warning:', err);
        setAgentState('idle');
        isListeningRef.current = false;
      }
    );

    recognizerRef.current = recognizer;
    recognizer.start();
  };

  // Stop Listening
  const stopListening = () => {
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      isListeningRef.current = false;
    }
    setAgentState('idle');
    setLiveTranscript('');
  };

  // Toggle Listening
  const handleToggleListen = () => {
    if (liveStatus === 'connected') {
      handleToggleMute();
    } else if (agentState === 'listening') {
      stopListening();
    } else {
      startListening();
    }
  };

  // Stop speaking / Interrupt
  const handleStopSpeaking = () => {
    if (liveStatus === 'connected' && liveClientRef.current) {
      liveClientRef.current.stopAudioPlayback();
      setAgentState('listening');
    } else {
      stopCurrentAudio();
      setIsPlayingAudio(false);
      setActivePlayingId(null);
      setAgentState('idle');
    }
  };

  // Reset conversation
  const handleNewSession = () => {
    if (liveStatus === 'connected') {
      liveClientRef.current?.stop();
      setLiveStatus('disconnected');
    }
    stopCurrentAudio();
    stopListening();
    setLiveTranscript('');
    setMessages([
      {
        id: 'init-greeting-' + Date.now(),
        role: 'assistant',
        content: INITIAL_GREETING,
        timestamp: Date.now(),
        suggestedQuestions: [
          'What documents do you have in your knowledge base?',
          'Can you summarize the Aurora architecture notes?',
          'Tell me what makes your voice interaction unique.'
        ]
      }
    ]);
  };

  // Document Management handlers
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

  // Test voice preview in settings
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
      {/* Immersive Atmospheric Ambient Background Orbs */}
      <div 
        className="fixed inset-0 pointer-events-none z-0" 
        style={{ background: 'radial-gradient(circle at 50% 35%, #151821 0%, #050608 100%)', opacity: 0.85 }} 
      />
      <div className="fixed top-[-100px] left-[-100px] w-[500px] h-[500px] bg-emerald-500/10 blur-[140px] rounded-full pointer-events-none z-0" />
      <div className="fixed bottom-[-100px] right-[-100px] w-[550px] h-[550px] bg-amber-500/10 blur-[160px] rounded-full pointer-events-none z-0" />

      {/* Sticky Immersive Header */}
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

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-between max-w-5xl w-full mx-auto px-3 sm:px-6 relative z-10">
        {/* Interactive Voice Orb Hero */}
        <section aria-label="Natasha Voice Control" className="w-full">
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

        {/* Live Conversation Transcript */}
        <section aria-label="Conversation Transcript" className="flex-1 my-4">
          <div className="border-t border-white/10 pt-5">
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

      {/* Document Analyst Drawer */}
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

      {/* Voice Settings Modal */}
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

