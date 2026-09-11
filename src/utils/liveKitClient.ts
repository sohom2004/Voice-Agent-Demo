import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  RemoteTrackPublication,
  RemoteParticipant,
} from 'livekit-client';
import { DocumentFile } from '../types';

export type LiveSessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ModelActivityPayload {
  text?: string;
  phase?: string;
  status?: string;
  tool?: string;
}

export interface LiveKitClientOptions {
  onStatusChange?: (status: LiveSessionStatus) => void;
  onUserTranscript?: (text: string, isFinal?: boolean) => void;
  onModelTranscript?: (text: string, isFinal?: boolean) => void;
  onModelTurnComplete?: (fullText: string) => void;
  onModelActivity?: (payload: ModelActivityPayload) => void;
  onVolumeChange?: (inputLevel: number, outputLevel: number) => void;
  onError?: (err: string) => void;
}

export class LiveKitClient {
  private room: Room | null = null;
  private status: LiveSessionStatus = 'disconnected';
  private isMuted = false;
  private currentModelUtterance = '';
  private options: LiveKitClientOptions;
  private remoteAudioElements: HTMLMediaElement[] = [];
  private unmuteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LiveKitClientOptions = {}) {
    this.options = options;
  }

  private setStatus(status: LiveSessionStatus) {
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  public getStatus(): LiveSessionStatus {
    return this.status;
  }

  private setRemoteAudioMuted(muted: boolean) {
    for (const el of this.remoteAudioElements) {
      el.muted = muted;
      if (!muted) {
        void el.play().catch(() => undefined);
      }
    }
  }

  public async start(voiceName?: string, documents: DocumentFile[] = []): Promise<void> {
    this.stop();
    this.setStatus('connecting');

    try {
      const documentIds = documents.filter((d) => d.enabled).map((d) => d.id);
      const tokenRes = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'default_workspace',
          documentIds,
          voiceName: voiceName && voiceName !== 'browser' ? voiceName : 'Kore',
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to get LiveKit token');
      }

      const { token, url } = await tokenRes.json();
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Critical for barge-in: keep agent playback out of the mic so Gemini
        // can hear the user and actually interrupt instead of talking over them.
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true,
        },
      });
      this.room = room;

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === ConnectionState.Connected) {
          this.setStatus('connected');
        } else if (state === ConnectionState.Disconnected) {
          this.setStatus('disconnected');
        }
      });

      room.on(RoomEvent.TrackSubscribed, (
        track,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant
      ) => {
        if (track.kind === Track.Kind.Audio && participant.identity !== room.localParticipant.identity) {
          const element = track.attach();
          element.autoplay = true;
          document.body.appendChild(element);
          this.remoteAudioElements.push(element);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const detached = track.detach();
        for (const el of detached) {
          this.remoteAudioElements = this.remoteAudioElements.filter((x) => x !== el);
          el.remove();
        }
      });

      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const data = JSON.parse(new TextDecoder().decode(payload));
          if (data.type === 'user_transcript') {
            this.options.onUserTranscript?.(data.text, data.final);
          } else if (data.type === 'agent_transcript') {
            const isFinal = Boolean(data.final);
            this.currentModelUtterance = data.text;
            this.options.onModelTranscript?.(data.text, isFinal);
            if (isFinal) {
              // Fire turn-complete once per finalized utterance; App dedupes
              // if the assistant event was already committed in-place.
              this.options.onModelTurnComplete?.(data.text);
              this.currentModelUtterance = '';
            }
          } else if (data.type === 'model_activity') {
            this.options.onModelActivity?.({
              text: data.text,
              phase: data.phase,
              status: data.status,
              tool: data.tool,
            });
          }
        } catch {
          // ignore non-json payloads
        }
      });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(!this.isMuted, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
      });
      this.setStatus('connected');
    } catch (err: any) {
      this.setStatus('error');
      this.options.onError?.(err.message || 'LiveKit connection failed');
      throw err;
    }
  }

  public stop(): void {
    if (this.unmuteTimer) {
      clearTimeout(this.unmuteTimer);
      this.unmuteTimer = null;
    }
    for (const el of this.remoteAudioElements) {
      el.remove();
    }
    this.remoteAudioElements = [];
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    this.setStatus('disconnected');
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.room) {
      this.room.localParticipant.setMicrophoneEnabled(!this.isMuted, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
      });
    }
    return this.isMuted;
  }

  /** Immediately silence local playback and tell the agent to stop speaking. */
  public interrupt(): void {
    if (!this.room) return;

    this.setRemoteAudioMuted(true);
    if (this.unmuteTimer) clearTimeout(this.unmuteTimer);
    // Re-enable playback shortly so the agent's next reply is audible.
    this.unmuteTimer = setTimeout(() => {
      this.setRemoteAudioMuted(false);
      this.unmuteTimer = null;
    }, 450);

    const payload = new TextEncoder().encode(JSON.stringify({ type: 'interrupt' }));
    void this.room.localParticipant.publishData(payload, { reliable: true });
  }

  public sendText(text: string): void {
    if (!this.room) return;
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'user_text', text }));
    this.room.localParticipant.publishData(payload, { reliable: true });
    this.options.onUserTranscript?.(text);
  }
}
