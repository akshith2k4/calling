// src/index.js
import { config } from './config.js';
import { linenGrassReminderAgent as agent } from './agents/linenGrassReminder.js';
import { createPipelineFactory } from './core/PipelineFactory.js';
import { FillerManager } from './core/FillerManager.js';
import { ElevenLabsTTS } from './providers/tts/ElevenLabsTTS.js';
import { TwilioTelephony } from './providers/telephony/TwilioTelephony.js';
import { createServer } from './server/createServer.js';
import { makeCall } from './server/makeCall.js';

async function main() {
  // 1. Shared filler cache (pre-warmed once at startup)
  const fillers = new FillerManager({
    fillers: agent.fillers,
    prefetchFn: (text) => ElevenLabsTTS.prefetch({
      apiKey: config.ELEVENLABS_API_KEY,
      voiceId: agent.providers.tts.voiceId,
      model: agent.providers.tts.model,
      outputFormat: agent.providers.tts.outputFormat,
      text,
      speed: agent.providers.tts.speed || 1.0,
    }),
  });
  await fillers.prewarm();

  // 2. Pipeline factory (creates a fresh pipeline per call)
  const pipelineFactory = createPipelineFactory(agent, config, fillers);

  // 3. Telephony provider
  const telephony = new TwilioTelephony({
    accountSid: config.TWILIO_ACCOUNT_SID,
    authToken: config.TWILIO_AUTH_TOKEN,
    fromNumber: config.TWILIO_FROM_NUMBER,
    domain: config.DOMAIN,
    pipelineFactory,
  });

  // 4. Start server
  await createServer({ telephony, port: config.PORT });

  // 5. If invoked with --call, place an outbound call
  if (process.argv.includes('--call')) {
    await makeCall(telephony);
  }
}

main().catch(console.error);
