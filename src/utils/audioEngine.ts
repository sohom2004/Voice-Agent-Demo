// Audio Engine for Web Speech, Gemini TTS PCM/WAV playback, and Audio Visualizer

let sharedAudioCtx: AudioContext | null = null;
let currentSourceNode: AudioBufferSourceNode | null = null;
let currentAnalyser: AnalyserNode | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioCtx = new AudioCtx({ sampleRate: 24000 });
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

export function stopCurrentAudio() {
  if (currentSourceNode) {
    try {
      currentSourceNode.stop();
      currentSourceNode.disconnect();
    } catch {
      // ignore if already stopped
    }
    currentSourceNode = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Converts a base64 string to an ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Plays 24kHz 16-bit PCM mono audio returned by Gemini TTS
 */
export async function playPcmAudio(
  base64Audio: string,
  onEnded?: () => void,
  rate = 1.0
): Promise<{ duration: number; analyser: AnalyserNode }> {
  stopCurrentAudio();
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const arrayBuffer = base64ToArrayBuffer(base64Audio);

  let audioBuffer: AudioBuffer;

  // Check if it's already a WAV/MP3 container or raw PCM 16-bit
  const isWav = arrayBuffer.byteLength > 4 &&
    String.fromCharCode(...new Uint8Array(arrayBuffer.slice(0, 4))) === 'RIFF';

  if (isWav) {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } else {
    // Treat as raw 24000Hz 1-channel 16-bit little-endian PCM
    const int16Array = new Int16Array(arrayBuffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const sampleRate = 24000;
    audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRate);
    audioBuffer.copyToChannel(float32Array, 0);
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = rate;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  source.connect(analyser);
  analyser.connect(ctx.destination);

  currentSourceNode = source;
  currentAnalyser = analyser;

  return new Promise((resolve) => {
    source.onended = () => {
      if (currentSourceNode === source) {
        currentSourceNode = null;
      }
      onEnded?.();
    };

    source.start(0);
    resolve({ duration: audioBuffer.duration / rate, analyser });
  });
}

/**
 * Browser Speech Synthesis fallback
 */
export function speakWithBrowser(
  text: string,
  voiceName: string = 'Kore',
  rate: number = 1.0,
  pitch: number = 1.0,
  onStart?: () => void,
  onEnd?: () => void
): SpeechSynthesisUtterance | null {
  if (!('speechSynthesis' in window)) return null;

  stopCurrentAudio();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  utterance.pitch = pitch;

  const voices = window.speechSynthesis.getVoices();

  // Detect language from text characters
  let matchedVoice: SpeechSynthesisVoice | undefined;
  if (/[\u0900-\u097F]/.test(text)) {
    // Hindi / Devanagari
    matchedVoice = voices.find(v => v.lang.startsWith('hi'));
  } else if (/[\u0980-\u09FF]/.test(text)) {
    // Bengali
    matchedVoice = voices.find(v => v.lang.startsWith('bn'));
  } else if (/[\u0B80-\u0BFF]/.test(text)) {
    // Tamil
    matchedVoice = voices.find(v => v.lang.startsWith('ta'));
  } else if (/[\u0C00-\u0C7F]/.test(text)) {
    // Telugu
    matchedVoice = voices.find(v => v.lang.startsWith('te'));
  } else if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text)) {
    // Japanese / CJK
    matchedVoice = voices.find(v => v.lang.startsWith('ja') || v.lang.startsWith('zh'));
  } else if (/[\u0600-\u06FF]/.test(text)) {
    // Arabic / Urdu
    matchedVoice = voices.find(v => v.lang.startsWith('ar') || v.lang.startsWith('ur'));
  }

  // If no non-Latin match, check for Indian English voice for English text
  if (!matchedVoice) {
    matchedVoice = voices.find(v =>
      v.lang.toLowerCase().includes('en-in') ||
      v.name.toLowerCase().includes('india') ||
      v.name.toLowerCase().includes('heera') ||
      v.name.toLowerCase().includes('neerja') ||
      v.name.toLowerCase().includes('kavya')
    ) || voices.find(v =>
      v.lang.startsWith('en') &&
      (v.name.toLowerCase().includes('female') ||
        v.name.toLowerCase().includes('samantha') ||
        v.name.toLowerCase().includes('karen') ||
        v.name.toLowerCase().includes('natural') ||
        v.name.toLowerCase().includes('google'))
    ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
  }

  if (matchedVoice) {
    utterance.voice = matchedVoice;
  }

  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
  return utterance;
}

/**
 * Speech Recognition Wrapper
 */
export interface SpeechRecognitionController {
  start: () => void;
  stop: () => void;
  abort: () => void;
  isSupported: boolean;
}

export function createSpeechRecognizer(
  onResult: (transcript: string, isFinal: boolean) => void,
  onStart?: () => void,
  onEnd?: () => void,
  onError?: (err: string) => void
): SpeechRecognitionController {
  const SpeechRec = (window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  }).SpeechRecognition || (window as unknown as {
    webkitSpeechRecognition?: unknown;
  }).webkitSpeechRecognition;

  if (!SpeechRec) {
    return {
      start: () => onError?.('Speech recognition is not supported in this browser. Please use Chrome/Edge or type your message.'),
      stop: () => { },
      abort: () => { },
      isSupported: false
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognizer: any = null;
  let isExplicitlyActive = false;
  let accumulatedTranscript = '';
  let silenceTimer: number | null = null;

  const initRecognizer = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognizer = new (SpeechRec as any)();
    recognizer.continuous = true; // Stay active continuously!
    recognizer.interimResults = true;
    recognizer.lang = 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognizer.onresult = (event: any) => {
      let interimTranscript = '';
      let currentFinal = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          currentFinal += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (currentFinal) {
        accumulatedTranscript += (accumulatedTranscript ? ' ' : '') + currentFinal.trim();
      }

      const displayedText = accumulatedTranscript + (interimTranscript ? ' ' + interimTranscript : '');

      if (displayedText.trim()) {
        onResult(displayedText.trim(), false);

        // Reset silence timer for natural speech completion
        if (silenceTimer !== null) clearTimeout(silenceTimer);
        silenceTimer = window.setTimeout(() => {
          if (accumulatedTranscript.trim() || interimTranscript.trim()) {
            const finalToSend = (accumulatedTranscript + ' ' + interimTranscript).trim();
            if (finalToSend) {
              onResult(finalToSend, true);
              accumulatedTranscript = '';
            }
          }
        }, 1800);
      }
    };

    recognizer.onstart = () => {
      onStart?.();
    };

    recognizer.onend = () => {
      if (isExplicitlyActive) {
        // Auto-restart to maintain persistent continuous voice input
        try {
          recognizer.start();
        } catch {
          // ignore already started
        }
      } else {
        if (silenceTimer !== null) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
        if (accumulatedTranscript.trim()) {
          onResult(accumulatedTranscript.trim(), true);
          accumulatedTranscript = '';
        }
        onEnd?.();
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognizer.onerror = (event: any) => {
      if (event.error === 'no-speech' && isExplicitlyActive) {
        // Normal silence, keep listening
        return;
      }
      if (event.error !== 'aborted') {
        onError?.(event.error);
      }
    };
  };

  initRecognizer();

  return {
    start: () => {
      isExplicitlyActive = true;
      accumulatedTranscript = '';
      try {
        recognizer.start();
      } catch {
        // ignore if already running
      }
    },
    stop: () => {
      isExplicitlyActive = false;
      if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      try {
        recognizer.stop();
      } catch {
        // ignore
      }
    },
    abort: () => {
      isExplicitlyActive = false;
      if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      try {
        recognizer.abort();
      } catch {
        // ignore
      }
    },
    isSupported: true
  };
}

