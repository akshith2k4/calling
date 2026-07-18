// src/providers/telephony/TwilioTelephony.js
import twilio from 'twilio';
import { TelephonyProvider } from '../../core/interfaces.js';
import { TwilioTransport } from './TwilioTransport.js';
import { startCall, endCall, logEvent } from '../../services/ObservabilityService.js';
import { createWavBuffer } from '../../utils/wav.js';
import { uploadWavFile } from '../../services/S3Service.js';
import { extractCallOutcome } from '../../services/IntentService.js';

export class TwilioTelephony extends TelephonyProvider {
  constructor({ accountSid, authToken, fromNumber, domain, pipelineFactory }) {
    super();
    this.client = twilio(accountSid, authToken);
    this.fromNumber = fromNumber;
    this.domain = domain;
    this.pipelineFactory = pipelineFactory;
    this.prewarmed = new Map();
    this.callContexts = new Map();
  }

  async createCall({ to, context, machineDetection = true }) {
    if (!to || typeof to !== 'string' || !/^\+?[1-9]\d{1,14}$/.test(to.trim())) {
      throw new Error(`Invalid "to" phone number format: ${to}`);
    }
    let sanitizedContext = {};
    if (context && typeof context === 'object') {
      try {
        sanitizedContext = JSON.parse(JSON.stringify(context));
      } catch (err) {
        throw new Error(`Invalid context payload: ${err.message}`);
      }
    }
    sanitizedContext.toNumber = to.trim();

    const call = await this.client.calls.create({
      to: to.trim(),
      from: this.fromNumber,
      url: `https://${this.domain}/voice`,
      machineDetection: machineDetection ? 'Enable' : undefined,
      asyncAmd: machineDetection ? 'true' : undefined,
    });
    
    this.callContexts.set(call.sid, sanitizedContext);
    return call;
  }

  // ── HTTP webhook: AMD check + pre-warm + TwiML ──────────
  webhookHandler() {
    return (req, reply) => {
      const answeredBy = req.body?.AnsweredBy || req.query?.AnsweredBy || '';
      if (answeredBy.startsWith('machine')) {
        req.log.info({ answeredBy }, 'Answering machine detected. Hanging up.');
        return reply.type('text/xml')
          .send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
      }

      const callSid = req.body?.CallSid || req.query?.CallSid;
      if (callSid) {
        console.log(`[Pre-warm] Creating pipeline for CallSid: ${callSid}`);
        const context = this.callContexts.get(callSid) || {};
        context.toNumber = req.body?.To || req.query?.To || context.toNumber || 'unknown';
        this.callContexts.set(callSid, context);
        const pipeline = this.pipelineFactory(context);
        const prewarmPromise = pipeline.prewarm();
        this.prewarmed.set(callSid, { pipeline, prewarmPromise });
      }

      reply.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Response><Connect><Stream url="wss://${this.domain}/media"/></Connect></Response>`
      );
    };
  }

  // ── WebSocket media-stream handler ──────────────────────
  mediaStreamHandler() {
    return (connection, req) => {
      const ws = connection.socket ?? connection;
      let transport = null;
      let pipeline = null;
      let firstMediaLogged = false;

      let customerAudioBuffer = Buffer.alloc(0);
      let botAudioBuffer = Buffer.alloc(0);
      let callSid = null;
      let toNumber = 'unknown';
      let callEnded = false;

      const finishCall = async () => {
        if (callEnded) return;
        callEnded = true;

        if (pipeline) {
          pipeline.stop();
          const durationSecs = Math.round((Date.now() - pipeline.startTime) / 1000);
          const finalCost = pipeline.cost ? (pipeline.cost.totalCost || 0) : 0;
          const costBreakdown = pipeline.cost ? (pipeline.cost.breakdown || {}) : {};
          const transcript = pipeline.conversation ? pipeline.conversation.getMessages() : [];
          
          // Process S3 uploads and DB inserts asynchronously (background task)
          (async () => {
            try {
              const customerWav = createWavBuffer(customerAudioBuffer);
              const botWav = createWavBuffer(botAudioBuffer);

              const [customerUrl, botUrl] = await Promise.all([
                uploadWavFile(callSid, 'customer', customerWav),
                uploadWavFile(callSid, 'bot', botWav)
              ]);

              const recordingUrls = { customer: customerUrl, bot: botUrl };
              
              // Extract call outcome/status using IntentService
              const outcome = await extractCallOutcome(transcript);
              if (callSid) {
                await logEvent(callSid, 'call_outcome', outcome);
              }
              console.log(`[Intent] Call ${callSid} outcome:`, outcome);

              // ── SEND TO YOUR EXTERNAL API ──
              if (outcome.status !== 'unknown' && outcome.status !== 'error') {
                try {
                  console.log(`[External API] Would send outcome for ${callSid} to external API.`);
                } catch (apiErr) {
                  console.error('[External API] Failed to send outcome:', apiErr);
                }
              }

              await endCall(callSid, durationSecs, JSON.stringify(recordingUrls), transcript, finalCost, costBreakdown);
            } catch (err) {
              console.error('[TwilioTelephony] Error in background finishCall task:', err);
              try {
                await endCall(callSid, durationSecs, null, transcript, finalCost, costBreakdown);
              } catch (innerErr) {
                console.error('[TwilioTelephony] Failed to even end call in DB:', innerErr);
              }
            }
          })();
        }
      };

      ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString());

        if (data.event === 'start') {
          const streamSid = data.start.streamSid;
          callSid = data.start.callSid;
          req.log.info({ streamSid, callSid }, 'call started');

          const pre = this.prewarmed.get(callSid);
          if (pre) {
            pipeline = pre.pipeline;
            toNumber = pipeline.agent?.context?.toNumber || 'unknown';
            await pre.prewarmPromise;
            this.prewarmed.delete(callSid);
            this.callContexts.delete(callSid);
            console.log(`[Pre-warm] Using pre-warmed pipeline for ${callSid}`);
          } else {
            const context = this.callContexts.get(callSid) || {};
            toNumber = context.toNumber || 'unknown';
            pipeline = this.pipelineFactory(context);
            this.callContexts.delete(callSid);
            await pipeline.prewarm();
          }

          // Log start call to observability
          await startCall(callSid, toNumber, pipeline.agent?.name || 'unknown');

          transport = new TwilioTransport(ws, streamSid);
          
          // Listen to outbound bot audio
          transport.on('outboundMedia', (b64) => {
            const audioChunk = Buffer.from(b64, 'base64');
            botAudioBuffer = Buffer.concat([botAudioBuffer, audioChunk]);
          });

          pipeline.attachTransport(transport);
          pipeline.start({ callSid, streamSid });
        }

        if (data.event === 'media' && pipeline && pipeline.isStarted) {
          const audioChunk = Buffer.from(data.media.payload, 'base64');
          customerAudioBuffer = Buffer.concat([customerAudioBuffer, audioChunk]);

          if (!firstMediaLogged && pipeline.startTime) {
            firstMediaLogged = true;
            console.log(`[Net] Twilio→server first media: ${Date.now() - pipeline.startTime}ms`);
          }
          pipeline.handleIncomingAudio(data.media.payload);
        }

        if (data.event === 'mark' && transport) {
          transport.emit('mark', data.mark?.name);
        }

        if (data.event === 'stop') {
          await finishCall();
        }
      });

      ws.on('close', async () => {
        await finishCall();
      });
    };
  }
}
