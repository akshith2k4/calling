// src/providers/telephony/TwilioTelephony.js
import fs from 'fs';
import path from 'path';
import twilio from 'twilio';
import { TelephonyProvider } from '../../core/interfaces.js';
import { TwilioTransport } from './TwilioTransport.js';

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
    const call = await this.client.calls.create({
      to,
      from: this.fromNumber,
      url: `https://${this.domain}/voice`,
      machineDetection: machineDetection ? 'Enable' : undefined,
      asyncAmd: machineDetection ? 'true' : undefined,
    });
    if (context) {
      this.callContexts.set(call.sid, context);
    }
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
        const context = this.callContexts.get(callSid);
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
      let customerStream = null;
      let botStream = null;

      const recordingsDir = path.join(process.cwd(), 'recordings');
      if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
      }

      ws.on('message', async (raw) => {
        const data = JSON.parse(raw.toString());

        if (data.event === 'start') {
          const streamSid = data.start.streamSid;
          const callSid = data.start.callSid;
          req.log.info({ streamSid, callSid }, 'call started');

          customerStream = fs.createWriteStream(path.join(recordingsDir, `${callSid}-customer.raw`));
          botStream = fs.createWriteStream(path.join(recordingsDir, `${callSid}-bot.raw`));

          const pre = this.prewarmed.get(callSid);
          if (pre) {
            pipeline = pre.pipeline;
            await pre.prewarmPromise;
            this.prewarmed.delete(callSid);
            this.callContexts.delete(callSid);
            console.log(`[Pre-warm] Using pre-warmed pipeline for ${callSid}`);
          } else {
            const context = this.callContexts.get(callSid);
            pipeline = this.pipelineFactory(context);
            this.callContexts.delete(callSid);
            await pipeline.prewarm();
          }

          transport = new TwilioTransport(ws, streamSid);
          
          transport.on('outboundMedia', (b64) => {
            if (botStream) {
              botStream.write(Buffer.from(b64, 'base64'));
            }
          });

          pipeline.attachTransport(transport);
          pipeline.start({ callSid, streamSid });
        }

        if (data.event === 'media' && pipeline) {
          if (!firstMediaLogged && pipeline.startTime) {
            firstMediaLogged = true;
            console.log(`[Net] Twilio→server first media: ${Date.now() - pipeline.startTime}ms`);
          }
          if (customerStream && data.media?.payload) {
            customerStream.write(Buffer.from(data.media.payload, 'base64'));
          }
          pipeline.handleIncomingAudio(data.media.payload);
        }

        if (data.event === 'mark' && transport) {
          transport.emit('mark', data.mark?.name);
        }

        if (data.event === 'stop' && pipeline) {
          pipeline.stop();
          customerStream?.end();
          botStream?.end();
        }
      });

      ws.on('close', () => {
        pipeline?.stop();
        customerStream?.end();
        botStream?.end();
      });
    };
  }
}
