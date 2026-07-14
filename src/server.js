import 'dotenv/config';
import Fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import { ElevenLabsSTT } from './elevenlabs/sttStream.js';
import { ElevenLabsTTS } from './elevenlabs/ttsStream.js';
import { streamLLM } from './llm/openaiStream.js';

const fastify = Fastify({ logger: true });
await fastify.register(fastifyWs);

// Native form body parser using URLSearchParams to support Twilio AMD checks
fastify.addContentTypeParser('application/x-www-form-urlencoded', (req, payload, done) => {
  let body = '';
  payload.on('data', chunk => { body += chunk; });
  payload.on('end', () => {
    try {
      const parsed = Object.fromEntries(new URLSearchParams(body));
      done(null, parsed);
    } catch (err) {
      done(err);
    }
  });
});

const ORDER = {
  id: "ORD-12345",
  status: "Shipped",
  total: "32,990 rupees",
  items: "Sony WH-1000XM5 and 2 USB-C cables",
  tracking: "BD1234567890",
  eta: "July 12 by 7 PM"
};

const SYSTEM = `You are an order assistant. Order=${JSON.stringify(ORDER)}. Answer in under 15 words. Never use markdown. Speak numbers as words. Be extremely direct.`;

const FILLERS = [
  "Let me check that.",
  "One second.",
  "Okay, let me see.",
  "Sure, let me look at that."
];
const fillerCache = {};
const prewarmed = new Map();

async function prewarmFillers(apiKey, voiceId) {
  console.log('[Filler Cache] Pre-warming fillers...');
  for (const filler of FILLERS) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=ulaw_8000`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: filler,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });
      if (!response.ok) {
        throw new Error(`ElevenLabs TTS HTTP error: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      fillerCache[filler] = Buffer.from(buffer).toString('base64');
      console.log(`[Filler Cache] Cached: "${filler}" (${fillerCache[filler].length} bytes)`);
    } catch (err) {
      console.error(`[Filler Cache] Failed to cache "${filler}":`, err);
    }
  }
}

fastify.all('/voice', (req, reply) => {
  const answeredBy = req.body?.AnsweredBy || req.query?.AnsweredBy || '';
  if (answeredBy.startsWith('machine')) {
    fastify.log.info({ answeredBy }, 'Answering machine detected. Hanging up.');
    reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`);
    return;
  }

  const callSid = req.body?.CallSid || req.query?.CallSid;
  if (callSid) {
    console.log(`[Pre-warm] Initializing ElevenLabs streams early for CallSid: ${callSid}`);
    const stt = new ElevenLabsSTT({ apiKey: process.env.ELEVENLABS_API_KEY });
    const tts = new ElevenLabsTTS({
      apiKey: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID
    });
    stt.connect();
    const ttsPromise = tts.connect();
    prewarmed.set(callSid, { stt, tts, ttsPromise });
  }

  reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Connect><Stream url="wss://${process.env.DOMAIN}/media"/></Connect></Response>`);
});

fastify.register(async (f) => {
  f.get('/media', { websocket: true }, (connection) => {
    const twilioWs = connection.socket;
    let streamSid = null;
    let stt = null;
    let tts = null;
    let conversation = [{ role: 'system', content: SYSTEM }];
    
    // Conversation State Variables
    let turnId = 0;
    let aborter = null;
    let isSpeaking = false;
    let isGreeting = true; // lock barge-in during greeting
    let currentTurnStartTime = null;
    let firstAudioTimeLogged = false;
    let startEventTime = null;
    let firstMediaReceived = false;
    
    let isProcessing = false;
    let speechStart = 0;
    let currentMarkName = null;
    let lastBotFinish = 0;
    let bargeInLockUntil = 0;
    let lastFiller = null;

    // Cost tracking variables
    let totalLlmInputTokens = 0;
    let totalLlmOutputTokens = 0;
    let totalTtsChars = 0;

    const cleanup = () => {
      aborter?.abort();
      try { stt?.close(); } catch {}
      try { tts?.close(); } catch {}

      if (startEventTime) {
        const durationSec = (Date.now() - startEventTime) / 1000;
        
        // Twilio Outbound call ($0.014/min) + Media Stream ($0.004/min) = $0.018/min
        const twilioVoiceCost = (durationSec / 60) * 0.014;
        const twilioStreamCost = (durationSec / 60) * 0.004;
        const twilioTotal = twilioVoiceCost + twilioStreamCost;
        
        // STT (ElevenLabs Scribe Realtime): $0.39 / hour
        const sttTotal = (durationSec / 3600) * 0.39;
        
        // LLM (Groq Llama 3.1 8B): $0.05/M input, $0.08/M output
        const llmInputCost = totalLlmInputTokens * (0.05 / 1000000);
        const llmOutputCost = totalLlmOutputTokens * (0.08 / 1000000);
        const llmTotal = llmInputCost + llmOutputCost;
        
        // TTS (ElevenLabs Flash v2.5): $0.015 / 1,000 characters
        const ttsTotal = totalTtsChars * (0.015 / 1000);
        
        const grandTotal = twilioTotal + sttTotal + llmTotal + ttsTotal;
        
        console.log(`
=============================================================
                     CALL COST REPORT
=============================================================
Call Duration:       ${durationSec.toFixed(1)} seconds
-------------------------------------------------------------
Twilio Voice Cost:   $${twilioVoiceCost.toFixed(5)} ($0.0140/min)
Twilio Stream Cost:  $${twilioStreamCost.toFixed(5)} ($0.0040/min)
Twilio Total:        $${twilioTotal.toFixed(5)}
-------------------------------------------------------------
STT Cost (11Labs):   $${sttTotal.toFixed(5)} (Scribe $0.39/hr)
-------------------------------------------------------------
LLM Cost (Groq):     $${llmTotal.toFixed(5)}
  - Input Tokens:    ${totalLlmInputTokens} ($0.05/M)
  - Output Tokens:   ${totalLlmOutputTokens} ($0.08/M)
-------------------------------------------------------------
TTS Cost (11Labs):   $${ttsTotal.toFixed(5)}
  - Total Characters: ${totalTtsChars} ($0.015/1K chars)
-------------------------------------------------------------
GRAND TOTAL:         $${grandTotal.toFixed(5)}
=============================================================
`);
      }
    };

    twilioWs.on('message', async (raw) => {
      const data = JSON.parse(raw.toString());

      if (data.event === 'start') {
        startEventTime = Date.now();
        streamSid = data.start.streamSid;
        const callSid = data.start.callSid;
        fastify.log.info({ streamSid, callSid }, 'call started');

        const pre = prewarmed.get(callSid);
        if (pre) {
          console.log(`[Pre-warm] Using pre-warmed streams for CallSid: ${callSid}`);
          stt = pre.stt;
          tts = pre.tts;
          prewarmed.delete(callSid);
        } else {
          console.log(`[Pre-warm] No pre-warmed streams found for CallSid: ${callSid}. Creating new ones...`);
          stt = new ElevenLabsSTT({ apiKey: process.env.ELEVENLABS_API_KEY });
          stt.connect();
          tts = new ElevenLabsTTS({
            apiKey: process.env.ELEVENLABS_API_KEY,
            voiceId: process.env.ELEVENLABS_VOICE_ID
          });
          await tts.connect();
        }

        // Dynamically configure STT callback
        stt.onTranscript = async (text, isFinal) => {
          if (!isFinal) {
            if (isGreeting) return; // NEVER barge-in during greeting
            if (!isSpeaking) return;
            if (Date.now() < bargeInLockUntil) return;
            if (Date.now() - lastBotFinish < 600) return;

            // Track start of speech for debouncing
            if (speechStart === 0) {
              speechStart = Date.now();
            }

            if (text.length > 12 && Date.now() - speechStart > 800) {
              // Ignore backchannels and short partials
              const lower = text.toLowerCase().trim();
              if (['mm', 'yeah', 'okay', 'uh', 'hmm', 'ah'].includes(lower)) return;
              if (text.trim().split(/\s+/).length < 2) return; // need at least 2 words

              console.log(`[Barge-in] "${text}"`);
              bargeInLockUntil = Date.now() + 800;
              turnId++; // Cancel current LLM turn
              aborter?.abort();
              twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
              tts?.interrupt(false); // Soft interrupt (flushes generator but keeps socket open)
              isSpeaking = false;
            }
            return;
          }

          // Final committed transcript
          if (isProcessing) return;
          isProcessing = true;
          speechStart = 0; // Reset speech tracker

          // Play cached voice filler immediately to mask generation latency
          if (!isGreeting) {
            let fillerText;
            do {
              fillerText = FILLERS[Math.floor(Math.random() * FILLERS.length)];
            } while (fillerText === lastFiller && FILLERS.length > 1);
            
            lastFiller = fillerText;
            const cachedAudio = fillerCache[fillerText];
            if (cachedAudio) {
              console.log(`[Filler] Playing cached: "${fillerText}"`);
              isSpeaking = true;
              twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: cachedAudio } }));
              // Send mark for the filler
              currentMarkName = `filler-${Date.now()}`;
              twilioWs.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: currentMarkName } }));
            }
          }

          const myTurn = ++turnId;
          aborter?.abort();
          aborter = new AbortController();
          currentTurnStartTime = Date.now();
          firstAudioTimeLogged = false;
          
          // Reset TTS interrupt/ignore audio state for the new turn
          tts?.clearInterrupt();
          
          // Truncate conversation to keep history short and context clean (last 12 messages)
          if (conversation.length > 12) {
            conversation = [
              conversation[0], // Keep system prompt
              ...conversation.slice(-11)
            ];
          }
          
          conversation.push({ role: 'user', content: text });
          console.log(`[STT] Final: "${text}"`);

          try {
            await handleLLMResponse(myTurn);
          } catch (err) {
            console.error('[LLM Error]', err);
            if (myTurn === turnId) {
              const fallbackText = "I'm sorry, I am experiencing a temporary connection issue. Could you please repeat that?";
              tts?.clearInterrupt();
              fallbackText.split(/(\s+)/).forEach(w => tts?.sendTextChunk(w, true));
              tts?.flush();
              conversation.push({ role: 'assistant', content: fallbackText });
            }
          } finally {
            isProcessing = false;
          }
        };
        stt.onError = (e) => fastify.log.error(e, 'STT error');

        // Dynamically configure TTS callback
        tts.onAudio = (b64, isFinal) => {
          if (isGreeting) {
            if (!firstAudioTimeLogged) {
              firstAudioTimeLogged = true;
              console.log(`[Net] Greeting TTS first byte: ${Date.now() - startEventTime}ms after start event`);
            }
          } else if (currentTurnStartTime && !firstAudioTimeLogged) {
            firstAudioTimeLogged = true;
            console.log(`[Net] TTS first byte: ${Date.now() - currentTurnStartTime}ms`);
          }
          isSpeaking = true;
          twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: b64 } }));
          
          // Send mark to Twilio when audio generation is finished
          if (isFinal) {
            currentMarkName = `tts-${Date.now()}`;
            twilioWs.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: currentMarkName } }));
          }
        };

        // Wait for TTS connection if it was still in flight
        if (pre?.ttsPromise) {
          await pre.ttsPromise;
        }

        const greet = `Hi, your order ${ORDER.id} is ${ORDER.status}, arriving ${ORDER.eta}. What would you like to know?`;
        conversation.push({ role: 'assistant', content: greet });
        
        // Send greeting in word/whitespace chunks instead of subwords
        greet.split(/(\s+)/).forEach(w => tts.sendTextChunk(w, true));
        tts.flush();

        // Unlock barge-in 2.5s after greeting starts, or when Twilio mark says speaking finished
        setTimeout(() => { isGreeting = false; }, 2500);
      }

      if (data.event === 'media') {
        if (!firstMediaReceived && startEventTime) {
          firstMediaReceived = true;
          console.log(`[Net] Twilio->ngrok->Mac first media: ${Date.now() - startEventTime}ms`);
        }
        stt?.sendAudio(data.media.payload); // forward Twilio ulaw directly
      }

      if (data.event === 'mark') {
        if (data.mark?.name === currentMarkName || isGreeting) {
          isSpeaking = false;
          if (isGreeting) isGreeting = false;
          lastBotFinish = Date.now();
        }
      }

      if (data.event === 'stop') cleanup();
    });

    async function handleLLMResponse(myTurn) {
      let firstTokenTime = null;
      let full = '';
      let buffer = '';
      let isFirstChunk = true;

      for await (const token of streamLLM(conversation, aborter.signal)) {
        if (myTurn !== turnId) return; // aborted by barge-in
        if (!firstTokenTime && currentTurnStartTime) {
          firstTokenTime = Date.now();
          console.log(`[Latency] TTFT: ${firstTokenTime - currentTurnStartTime}ms`);
        }
        
        buffer += token;
        full += token;

        // Dynamic buffering logic:
        if (isFirstChunk) {
          // Send first chunk quickly (1 word or 5 chars) to get audio started
          const wordCount = buffer.trim().split(/\s+/).length;
          if (wordCount >= 1 || buffer.length >= 5 || /[\.\?\!\,\;]$/.test(buffer)) {
            tts.sendTextChunk(buffer, true);
            buffer = '';
            isFirstChunk = false;
          }
        } else {
          // Subsequent chunks: buffer for natural phrase flow (punctuation or >= 40 chars)
          if (/[\,\.\?\!\;]$/.test(buffer) || (buffer.length >= 40 && /[\s]$/.test(buffer))) {
            tts.sendTextChunk(buffer, true);
            buffer = '';
          }
        }
      }
      
      if (myTurn !== turnId) return;
      if (buffer) {
        tts.sendTextChunk(buffer, true);
      }
      tts.flush();
      
      conversation.push({ role: 'assistant', content: full });
      console.log(`[LLM] Response: "${full}"`);

      // Track token/character usage (standard heuristic: ~4 chars per token)
      const inputTokens = Math.round(JSON.stringify(conversation).length / 4);
      const outputTokens = Math.round(full.length / 4);
      totalLlmInputTokens += inputTokens;
      totalLlmOutputTokens += outputTokens;
      totalTtsChars += full.length;
    }

    twilioWs.on('close', cleanup);
  });
});

// Prewarm the fillers with ElevenLabs on startup, then listen
await prewarmFillers(process.env.ELEVENLABS_API_KEY, process.env.ELEVENLABS_VOICE_ID);
fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
