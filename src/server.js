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

const SYSTEM = `You are order assistant. Order=${JSON.stringify(ORDER)}. Be concise, 2 sentences max. No markdown. Speak numbers as words.`;

const FILLERS = [
  "Let me check that.",
  "One second.",
  "Okay, let me see.",
  "Sure, let me look at that."
];
const fillerCache = {};

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

    const cleanup = () => {
      aborter?.abort();
      try { stt?.close(); } catch {}
      try { tts?.close(); } catch {}
    };

    twilioWs.on('message', async (raw) => {
      const data = JSON.parse(raw.toString());

      if (data.event === 'start') {
        startEventTime = Date.now();
        streamSid = data.start.streamSid;
        fastify.log.info({ streamSid }, 'call started');

        // 1. Start STT
        stt = new ElevenLabsSTT({
          apiKey: process.env.ELEVENLABS_API_KEY,
          onTranscript: async (text, isFinal) => {
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

            /*
            // Send a pre-warmed voice filler instantly to Twilio
            const randomFiller = FILLERS[Math.floor(Math.random() * FILLERS.length)];
            const cachedAudio = fillerCache[randomFiller];
            if (cachedAudio) {
              console.log(`[Filler] Playing cached: "${randomFiller}"`);
              isSpeaking = true;
              twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: cachedAudio } }));
              // Send mark for the filler
              currentMarkName = `filler-${Date.now()}`;
              twilioWs.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: currentMarkName } }));
            } else {
              console.log(`[Filler] Cache miss, playing text: "${randomFiller}"`);
              tts.sendTextChunk(randomFiller + " ", true);
              tts.flush();
            }
            */

            try {
              await handleLLMResponse(myTurn);
            } finally {
              isProcessing = false;
            }
          },
          onError: (e) => fastify.log.error(e, 'STT error')
        });
        stt.connect();

        // 2. Start TTS (Single persistent session)
        tts = new ElevenLabsTTS({
          apiKey: process.env.ELEVENLABS_API_KEY,
          voiceId: process.env.ELEVENLABS_VOICE_ID,
          onAudio: (b64, isFinal) => {
            if (isGreeting) {
              console.log(`[Greeting] audio byte`);
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
          }
        });

        await tts.connect(); // WAIT for open, no more 150ms guess
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

      for await (const token of streamLLM(conversation, aborter.signal)) {
        if (myTurn !== turnId) return; // aborted by barge-in
        if (!firstTokenTime && currentTurnStartTime) {
          firstTokenTime = Date.now();
          console.log(`[Latency] TTFT: ${firstTokenTime - currentTurnStartTime}ms`);
        }
        
        buffer += token;
        // Send to TTS only on word/space boundaries to avoid subword token latency in synthesis
        if (/[\s\.\?\!]$/.test(buffer)) {
          tts.sendTextChunk(buffer, true);
          buffer = '';
        }
        full += token;
      }
      
      if (myTurn !== turnId) return;
      if (buffer) {
        tts.sendTextChunk(buffer, true);
      }
      tts.flush();
      
      conversation.push({ role: 'assistant', content: full });
      console.log(`[LLM] Response: "${full}"`);
    }

    twilioWs.on('close', cleanup);
  });
});

// Prewarm the fillers with ElevenLabs on startup, then listen
await prewarmFillers(process.env.ELEVENLABS_API_KEY, process.env.ELEVENLABS_VOICE_ID);
fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
