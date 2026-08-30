export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  audioBase64?: string;
  audioDuration?: number;
  isAudioLoading?: boolean;
  groundedDocuments?: string[];
  suggestedQuestions?: string[];
}

export interface DocumentFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content?: string;
  uploadedAt: number;
  summary?: string;
  suggestedQuestions?: string[];
  enabled: boolean;
  status?: 'uploaded' | 'processing' | 'ready' | 'failed';
  error?: string;
}

export type VoiceName = 'Kore' | 'Aoede' | 'Zephyr' | 'Puck' | 'Fenrir' | 'Charon' | 'browser';

export type AgentState = 'idle' | 'listening' | 'processing' | 'speaking' | 'muted';

export type LiveConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface VoiceSettings {
  selectedVoice: VoiceName;
  speechRate: number;
  pitch: number;
  autoSpeak: boolean;
  continuousMode: boolean;
  useGeminiTTS: boolean;
  liveModeEnabled: boolean;
}

