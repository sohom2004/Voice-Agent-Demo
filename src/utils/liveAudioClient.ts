import { DocumentFile, VoiceName, AgentState } from '../types';

export type LiveSessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LiveAudioClientOptions {
  onStatusChange?: (status: LiveSessionStatus) => void;
  onAgentStateChange?: (state: AgentState) => void;
  onUserTranscript?: (text: string) => void;
  onModelTranscript?: (text: string, isFinal: boolean) => void;
  onModelTurnComplete?: (fullText: string) => void;
  onVolumeChange?: (inputLevel: number, outputLevel: number) => void;
  onError?: (err: string) => void;
}

export class LiveAudioClient {
  private ws: WebSocket | null = null;
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputProcessor: ScriptProcessorNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;

  private activeSources: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  private isMuted = false;
  private status: LiveSessionStatus = 'disconnected';
  private currentModelUtterance = '';
  private currentUserUtterance = '';
  private volumeInterval: number | null = null;
  private options: LiveAudioClientOptions;

  constructor(options: LiveAudioClientOptions = {}) {
    this.options = options;
  }

  public getStatus(): LiveSessionStatus {
    return this.status;
  }

  private setStatus(newStatus: LiveSessionStatus) {
    this.status = newStatus;
    this.options.onStatusChange?.(newStatus);
  }

  /**
   * Start bidirectional real-time Gemini Live audio session
   */
  public async start(voiceName: VoiceName = 'Kore', documents: DocumentFile[] = []): Promise<void> {
    this.stop();
    this.setStatus('connecting');
    this.options.onAgentStateChange?.('processing');

    try {
      // 1. Establish WebSocket connection to backend live endpoint
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/live`;

      this.ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Live connection timed out after 10s'));
        }, 10000);

        if (!this.ws) return;

        this.ws.onopen = () => {
          clearTimeout(timeout);
          // Send initialization payload
          this.ws?.send(
            JSON.stringify({
              type: 'init',
              voiceName: voiceName === 'browser' ? 'Kore' : voiceName,
              activeDocumentIds: documents.filter((d) => d.enabled).map((d) => d.id),
              workspaceId: 'default_workspace'
            })
          );
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'ready') {
              resolve();
            } else {
              this.handleServerMessage(data);
            }
          } catch (e) {
            console.warn('[LiveClient] JSON parse error:', e);
          }
        };

        this.ws.onerror = (err) => {
          clearTimeout(timeout);
          reject(err);
        };

        this.ws.onclose = () => {
          this.handleClose();
        };
      });

      this.setStatus('connected');
      this.options.onAgentStateChange?.('listening');

      // 2. Initialize Output Audio Context (24kHz for Gemini Live output)
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      this.outputAudioCtx = new AudioCtx({ sampleRate: 24000 });
      if (this.outputAudioCtx.state === 'suspended') {
        await this.outputAudioCtx.resume();
      }

      this.outputAnalyser = this.outputAudioCtx.createAnalyser();
      this.outputAnalyser.fftSize = 64;
      this.outputAnalyser.smoothingTimeConstant = 0.6;
      this.outputAnalyser.connect(this.outputAudioCtx.destination);

      // 3. Initialize Input Microphone Stream (16kHz for Gemini Live input)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.inputAudioCtx = new AudioCtx({ sampleRate: 16000 });
      if (this.inputAudioCtx.state === 'suspended') {
        await this.inputAudioCtx.resume();
      }

      this.inputSource = this.inputAudioCtx.createMediaStreamSource(this.mediaStream);
      this.inputAnalyser = this.inputAudioCtx.createAnalyser();
      this.inputAnalyser.fftSize = 64;
      this.inputAnalyser.smoothingTimeConstant = 0.6;

      // Script Processor to continuously buffer and send 16kHz PCM
      this.inputProcessor = this.inputAudioCtx.createScriptProcessor(2048, 1, 1);

      this.inputProcessor.onaudioprocess = (e) => {
        if (this.isMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);

        // Calculate RMS energy for instant speech detection & barge-in
        let sumSquares = 0;
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          sumSquares += s * s;
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const rms = Math.sqrt(sumSquares / float32.length);

        // Immediate stop & listen: If user speaks while Natasha is playing audio, halt playback immediately!
        if (this.activeSources.length > 0 && rms > 0.025) {
          this.stopAudioPlayback();
          this.options.onAgentStateChange?.('listening');
        }

        // Convert to base64
        const base64 = this.arrayBufferToBase64(int16.buffer);
        this.ws.send(JSON.stringify({ type: 'audio', audio: base64 }));
      };

      this.inputSource.connect(this.inputAnalyser);
      this.inputSource.connect(this.inputProcessor);
      this.inputProcessor.connect(this.inputAudioCtx.destination);

      // 4. Start volume polling for visualizer
      this.startVolumePolling();
    } catch (err: unknown) {
      console.error('[LiveClient] Failed to start Live session:', err);
      const errMsg = err instanceof Error ? err.message : 'Could not initialize microphone or live stream';
      this.setStatus('error');
      this.options.onError?.(errMsg);
      this.options.onAgentStateChange?.('idle');
      this.stop();
      throw err;
    }
  }

  /**
   * Handle incoming messages from Gemini Live server
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleServerMessage(data: any) {
    if (data.type === 'audio' && data.audio) {
      this.playAudioChunk(data.audio);
    } else if (data.type === 'interrupted') {
      console.log('[LiveClient] Interrupted by user');
      this.stopAudioPlayback();
      this.options.onAgentStateChange?.('listening');
    } else if (data.type === 'user_transcription' && data.text) {
      if (this.activeSources.length > 0) {
        this.stopAudioPlayback();
        this.options.onAgentStateChange?.('listening');
      }
      this.currentUserUtterance += data.text;
      this.options.onUserTranscript?.(this.currentUserUtterance);
    } else if (data.type === 'model_transcription' && data.text) {
      this.currentModelUtterance += data.text;
      this.options.onModelTranscript?.(this.currentModelUtterance, false);
    } else if (data.type === 'model_text' && data.text) {
      this.currentModelUtterance += data.text;
      this.options.onModelTranscript?.(this.currentModelUtterance, false);
    } else if (data.type === 'turn_complete') {
      if (this.currentModelUtterance) {
        this.options.onModelTurnComplete?.(this.currentModelUtterance);
      }
      this.currentModelUtterance = '';
      this.currentUserUtterance = '';
    } else if (data.type === 'error') {
      this.options.onError?.(data.message || 'Error from Live service');
    }
  }

  /**
   * Schedules a raw 24kHz 16-bit PCM audio chunk for gapless playback
   */
  private playAudioChunk(base64Pcm: string) {
    if (!this.outputAudioCtx || !this.outputAnalyser) return;

    try {
      this.options.onAgentStateChange?.('speaking');

      const arrayBuffer = this.base64ToArrayBuffer(base64Pcm);
      const int16 = new Int16Array(arrayBuffer);
      const float32 = new Float32Array(int16.length);

      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const audioBuffer = this.outputAudioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.copyToChannel(float32, 0);

      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAnalyser);

      // Audio scheduling for gapless playback
      const currentTime = this.outputAudioCtx.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime + 0.02; // tiny 20ms jitter buffer
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;

      this.activeSources.push(source);

      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx > -1) {
          this.activeSources.splice(idx, 1);
        }
        if (this.activeSources.length === 0 && this.status === 'connected') {
          this.options.onAgentStateChange?.('listening');
        }
      };
    } catch (err) {
      console.warn('[LiveClient] Error playing audio chunk:', err);
    }
  }

  /**
   * Stop all currently scheduled and playing audio
   */
  public stopAudioPlayback() {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    this.activeSources = [];
    if (this.outputAudioCtx) {
      this.nextStartTime = this.outputAudioCtx.currentTime;
    }
  }

  /**
   * Send real-time text prompt into the Live session
   */
  public sendText(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'text', text }));
    }
  }

  /**
   * Toggle mute state
   */
  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.options.onAgentStateChange?.('muted');
    } else {
      this.options.onAgentStateChange?.('listening');
    }
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Polling for audio volume levels (waveform reactivity)
   */
  private startVolumePolling() {
    const inputData = new Uint8Array(32);
    const outputData = new Uint8Array(32);

    this.volumeInterval = window.setInterval(() => {
      let inVol = 0;
      let outVol = 0;

      if (this.inputAnalyser && !this.isMuted) {
        this.inputAnalyser.getByteFrequencyData(inputData);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) sum += inputData[i];
        inVol = sum / inputData.length / 255;
      }

      if (this.outputAnalyser && this.activeSources.length > 0) {
        this.outputAnalyser.getByteFrequencyData(outputData);
        let sum = 0;
        for (let i = 0; i < outputData.length; i++) sum += outputData[i];
        outVol = sum / outputData.length / 255;
      }

      this.options.onVolumeChange?.(inVol, outVol);
    }, 60);
  }

  private handleClose() {
    this.setStatus('disconnected');
    this.options.onAgentStateChange?.('idle');
  }

  /**
   * Completely shut down live session and audio streams
   */
  public stop() {
    if (this.volumeInterval !== null) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }

    this.stopAudioPlayback();

    if (this.inputProcessor) {
      this.inputProcessor.disconnect();
      this.inputProcessor = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.inputAudioCtx && this.inputAudioCtx.state !== 'closed') {
      this.inputAudioCtx.close().catch(() => { });
      this.inputAudioCtx = null;
    }
    if (this.outputAudioCtx && this.outputAudioCtx.state !== 'closed') {
      this.outputAudioCtx.close().catch(() => { });
      this.outputAudioCtx = null;
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'close' }));
      }
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('disconnected');
    this.options.onAgentStateChange?.('idle');
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
