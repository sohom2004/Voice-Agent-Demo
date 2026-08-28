import express from 'express';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;
const server = http.createServer(app);

// Allow large payloads for audio base64 and document uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Lazy initialize Gemini client
function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}


// Natasha System Prompt Builder
function buildSystemPrompt(documents: Array<{ name: string; content: string; enabled?: boolean }> = []) {
  const activeDocs = (documents || []).filter(d => d.enabled !== false && d.content);
  
  let docContext = '';
  if (activeDocs.length > 0) {
    docContext = `\n\n--- UPLOADED DOCUMENTS AVAILABLE FOR CONTEXT ---\n` +
      activeDocs.map((doc, idx) => `[DOCUMENT ${idx + 1}: ${doc.name}]\n${doc.content}\n[END OF ${doc.name}]`).join('\n\n') +
      `\n--- END OF UPLOADED DOCUMENTS ---\n`;
  }

  return `# IDENTITY & PERSONA
You are Natasha, an intelligent, warm, highly adaptive, and polyglot real-time voice companion and document analyst.
Your tone is professional, conversational, approachable, empathetic, eloquent, and witty when appropriate.

# 1. DYNAMIC MULTILINGUAL SWITCHING (ZERO-CONFIGURATION)
- DYNAMICALLY SWITCH LANGUAGES: Automatically detect whatever language or dialect the user is speaking in, and IMMEDIATELY respond in that EXACT same language.
- The user does NOT need to specify, configure, or announce their language.
- Seamlessly support all global and regional languages, including:
  * Indian languages: Hindi (हिंदी), Bengali (বাংলা), Tamil (தமிழ்), Telugu (తెలుగు), Marathi (मराठी), Gujarati (ગુજરાતી), Punjabi (ਪੰਜਾਬੀ), Kannada (ಕನ್ನಡ), Malayalam (മലയാളം), Urdu (اردو), etc.
  * Code-mixing & Hinglish (e.g., "Kya chal raha hai?", "Can you explain this doc in simple Hindi?").
  * Global languages: Spanish, French, German, Japanese, Mandarin, Italian, Portuguese, Arabic, Russian, Korean, etc.
- MID-CONVERSATION SWITCHING: If the user changes languages mid-conversation (e.g., starts in English, switches to Hindi, then to Spanish or Bengali), switch IMMEDIATELY with the user without commenting on the language switch.

# 2. ACCENT & PHONETIC AUTHENTICITY
- INDIAN ENGLISH ACCENT & CADENCE: When speaking English, speak with a natural, articulate, warm Indian English accent, intonation, and rhythm (pleasant Indian English cadence, natural inflection, clear phrasing, and authentic Indian conversational style).
- NATIVE ACCENT FOR OTHER LANGUAGES: When speaking any language other than English (such as Hindi, Bengali, Spanish, French, German, Japanese, Tamil, etc.), speak with an authentic, fluent, native speaker accent, natural phonetics, rich localized vocabulary, and natural prosody. Never speak regional languages with a foreign or robotic accent.

# 3. ATTENTIVE TURN-TAKING & IMMEDIATE STOP ON USER SPEECH
- NEVER TALK OVER THE USER: Whenever the user begins speaking or makes a sound, you must immediately stop speaking, remain completely silent, and listen attentively.
- WAIT FOR COMPLETION: Patiently wait until the user has finished their complete thought or sentence before generating and delivering your response.
- CONCISE, NATURAL SPOKEN CADENCE: Keep answers bite-sized, engaging, and spoken aloud. Avoid long unbroken monologues.

# 4. VOICE-FIRST AUDIO CADENCE RULES
- You are speaking aloud in an audio conversation. Speak naturally as if engaged in real-time audio dialogue.
- ABSOLUTELY AVOID visual formatting artifacts that disrupt Text-to-Speech (TTS) natural cadence:
  * NEVER output markdown asterisks (*, **), hashtags (#), bullet point characters (-, •), or numbered markdown lists.
  * NEVER say words like "asterisk", "hashtag", or "bullet point".
  * NEVER output complex raw tables, raw URLs, or code blocks with triple backticks.
  * Summarize code, configurations, numbers, or data structures conversationally instead of reading raw syntax.
- CONVERSATIONAL FLOW: Use natural transitional phrases (e.g., "From what I see in your notes...", "Sure thing!", "Haan bilkul!").

# 5. DOCUMENT GROUNDING & RETRIEVAL (RAG / CONTEXT ANALYSIS)
${activeDocs.length > 0 
  ? `- You have active user-uploaded documents provided below.
- PRIORITIZE uploaded content over general knowledge for project-specific questions.
- Maintain strict factual adherence to the provided documents when answering context-specific questions.
- CRITICAL FALLBACK RULE: If the user asks a question about the project or uploaded file and the answer is NOT in the uploaded file, you MUST state clearly in the user's current language:
  "I looked through the document, but it doesn't mention that. Would you like me to answer using general knowledge instead?"`
  : `- No documents are currently uploaded. Seamlessly operate as an open-ended conversational assistant without bringing up file requirements unless specifically asked.`}
${docContext}`;
}

// API Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'Natasha Voice Agent API' });
});

// Chat Endpoint (Generates text response + optional TTS audio)
app.post('/api/chat', async (req, res) => {
  try {
    const { 
      message, 
      history = [], 
      documents = [], 
      voiceName = 'Kore', 
      generateAudio = true 
    } = req.body;

    if (!message && (!history || history.length === 0)) {
      return res.status(400).json({ error: 'Message or history is required.' });
    }

    const ai = getGenAI();
    const systemPrompt = buildSystemPrompt(documents);

    // Format conversation history for Gemini
    const contents = [];
    
    // Add past history if provided
    for (const h of history) {
      if (h.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: h.content }] });
      } else if (h.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: h.content }] });
      }
    }

    // Append latest user message if not already in history
    if (message) {
      contents.push({ role: 'user', parts: [{ text: message }] });
    }

    // Call Gemini 3.7 Flash for conversational reasoning
    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
      },
    });

    const replyText = response.text?.trim() || "I'm right here. How can I help you next?";

    // Generate follow-up suggestions
    let suggestedQuestions: string[] = [];
    try {
      const followUpPrompt = `Based on this latest answer from Natasha: "${replyText.slice(0, 300)}", generate exactly 3 short, natural spoken follow-up questions or prompts that a user might ask out loud. Return only the 3 questions separated by newlines, no numbers, no bullets, no quotes.`;
      const followUpRes = await ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents: followUpPrompt,
      });
      const lines = (followUpRes.text || '')
        .split('\n')
        .map(l => l.replace(/^[-*0-9.)\s]+/, '').trim())
        .filter(l => l.length > 5 && l.length < 80)
        .slice(0, 3);
      if (lines.length > 0) {
        suggestedQuestions = lines;
      }
    } catch {
      suggestedQuestions = [
        'Can you summarize that in one sentence?',
        'Tell me more about this.',
        'What should we look at next?'
      ];
    }

    // Check which documents were grounded
    const activeDocNames = (documents || [])
      .filter((d: { enabled?: boolean; name?: string }) => d.enabled !== false && d.name)
      .map((d: { name: string }) => d.name);

    let audioBase64: string | undefined;

    // Generate TTS Audio if requested
    if (generateAudio && replyText) {
      try {
        // Clean any stray characters that could affect TTS
        const cleanForTts = replyText
          .replace(/[*#_`~[\]]/g, '')
          .replace(/\n+/g, ' ')
          .slice(0, 1500); // Safety limit for single audio segment

        const validVoices = ['Kore', 'Aoede', 'Zephyr', 'Puck', 'Fenrir', 'Charon'];
        const selectedVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';

        const ttsResponse = await ai.models.generateContent({
          model: 'gemini-3.1-flash-tts-preview',
          contents: [{ parts: [{ text: cleanForTts }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
          },
        });

        audioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      } catch (ttsErr) {
        console.warn('Gemini TTS warning (client will use browser speech fallback):', ttsErr);
      }
    }

    res.json({
      text: replyText,
      audioBase64,
      suggestedQuestions,
      groundedDocs: activeDocNames,
    });
  } catch (error: unknown) {
    console.error('Chat error:', error);
    const errMessage = error instanceof Error ? error.message : 'Unknown server error';
    res.status(500).json({ error: errMessage });
  }
});

// Standalone Text-To-Speech (TTS) Endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voiceName = 'Kore' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required for TTS.' });
    }

    const ai = getGenAI();
    const cleanText = text.replace(/[*#_`~[\]]/g, '').replace(/\n+/g, ' ').slice(0, 1500);
    const validVoices = ['Kore', 'Aoede', 'Zephyr', 'Puck', 'Fenrir', 'Charon'];
    const selectedVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';

    const ttsResponse = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text: cleanText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice },
          },
        },
      },
    });

    const audioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBase64) {
      return res.status(500).json({ error: 'No audio generated by TTS model.' });
    }

    res.json({ audioBase64 });
  } catch (error: unknown) {
    console.error('TTS error:', error);
    const errMessage = error instanceof Error ? error.message : 'TTS generation failed';
    res.status(500).json({ error: errMessage });
  }
});

// Document Fast Analyzer Endpoint
app.post('/api/analyze-document', async (req, res) => {
  try {
    const { name, content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Document content is required.' });
    }

    const ai = getGenAI();
    const prompt = `Analyze this document named "${name}":
---
${content.slice(0, 8000)}
---

Provide:
1. A concise 1-to-2 sentence conversational spoken summary of what this document contains (written in Natasha's voice, no markdown, no bullets).
2. Exactly 3 intriguing spoken questions a user might ask Natasha about this document.

Format your output exactly as JSON:
{
  "summary": "...",
  "suggestedQuestions": ["...", "...", "..."]
}`;

    const analysisRes = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let result = { summary: '', suggestedQuestions: [] };
    try {
      result = JSON.parse(analysisRes.text || '{}');
    } catch {
      result = {
        summary: `Document ${name} containing ${Math.round(content.length / 4)} tokens.`,
        suggestedQuestions: [
          `What are the main points in ${name}?`,
          `Can you summarize ${name} for me?`,
          `What are the key takeaways?`
        ]
      };
    }

    res.json(result);
  } catch (error: unknown) {
    console.error('Document analysis error:', error);
    const errMessage = error instanceof Error ? error.message : 'Document analysis failed';
    res.status(500).json({ error: errMessage });
  }
});

// Audio Transcription Endpoint (Gemini 3.5 Transcribe)
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm' } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required.' });
    }

    const ai = getGenAI();
    const audioPart = {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: { parts: [audioPart, { text: 'Transcribe this voice audio accurately into plain text.' }] },
    });

    res.json({ transcript: response.text?.trim() || '' });
  } catch (error: unknown) {
    console.error('Transcribe error:', error);
    const errMessage = error instanceof Error ? error.message : 'Transcription failed';
    res.status(500).json({ error: errMessage });
  }
});

// Gemini Live API WebSocket Server for Real-Time Duplex Voice Sessions
const wss = new WebSocketServer({ server, path: '/api/live' });

wss.on('connection', async (clientWs: WebSocket) => {
  console.log('[Live API] Client connected to real-time voice stream');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let session: any = null;
  let isSessionClosed = false;

  const closeLiveSession = () => {
    if (session && !isSessionClosed) {
      isSessionClosed = true;
      try {
        session.close();
      } catch (err) {
        console.warn('[Live API] Error closing session:', err);
      }
      session = null;
    }
  };

  clientWs.on('message', async (rawMsg: Buffer | string) => {
    try {
      const data = JSON.parse(rawMsg.toString());

      if (data.type === 'init') {
        const { voiceName = 'Kore', documents = [] } = data;
        const validVoices = ['Kore', 'Aoede', 'Zephyr', 'Puck', 'Fenrir', 'Charon'];
        const selectedVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';

        const ai = getGenAI();
        const systemPrompt = buildSystemPrompt(documents);

        console.log(`[Live API] Connecting Gemini Live session with voice: ${selectedVoice}`);
        
        session = await ai.live.connect({
          model: 'gemini-3.1-flash-live-preview',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
            systemInstruction: systemPrompt,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              if (clientWs.readyState !== WebSocket.OPEN) return;

              // Check if interrupted by user
              if (message.serverContent?.interrupted) {
                clientWs.send(JSON.stringify({ type: 'interrupted' }));
              }

              // Check user input transcription
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const sc = message.serverContent as any;
              if (sc?.inputAudioTranscription?.parts) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const userText = sc.inputAudioTranscription.parts.map((p: any) => p.text || '').join('');
                if (userText) {
                  clientWs.send(JSON.stringify({ type: 'user_transcription', text: userText }));
                }
              }

              // Check model output transcription
              if (sc?.outputAudioTranscription?.parts) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const modelText = sc.outputAudioTranscription.parts.map((p: any) => p.text || '').join('');
                if (modelText) {
                  clientWs.send(JSON.stringify({ type: 'model_transcription', text: modelText }));
                }
              }

              // Check model turn parts (audio and text)
              const parts = message.serverContent?.modelTurn?.parts;
              if (parts) {
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    clientWs.send(JSON.stringify({ 
                      type: 'audio', 
                      audio: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000'
                    }));
                  }
                  if (part.text) {
                    clientWs.send(JSON.stringify({ type: 'model_text', text: part.text }));
                  }
                }
              }

              // Check turn complete
              if (message.serverContent?.turnComplete) {
                clientWs.send(JSON.stringify({ type: 'turn_complete' }));
              }
            },
            onclose: (e) => {
              console.log('[Live API] Gemini session closed:', e);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'session_closed' }));
              }
            },
            onerror: (err) => {
              console.error('[Live API] Gemini session error:', err);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'error', message: err?.message || 'Live session error' }));
              }
            }
          }
        });

        clientWs.send(JSON.stringify({ type: 'ready' }));
      } else if (data.type === 'audio' && session) {
        // Send continuous 16kHz PCM audio
        session.sendRealtimeInput({
          audio: {
            data: data.audio,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } else if (data.type === 'text' && session) {
        // Send real-time text prompt
        session.sendRealtimeInput({
          text: data.text,
        });
      } else if (data.type === 'close') {
        closeLiveSession();
      }
    } catch (err: unknown) {
      console.error('[Live API] Message handling error:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', message: errMsg }));
      }
    }
  });

  clientWs.on('close', () => {
    console.log('[Live API] Client disconnected');
    closeLiveSession();
  });

  clientWs.on('error', (err) => {
    console.warn('[Live API] Client WebSocket error:', err);
    closeLiveSession();
  });
});

// Vite middleware & Production Serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Natasha Voice Agent server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();

