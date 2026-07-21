// src/server/createServer.js
import Fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import { attachObservabilityWebSocket } from '../services/ObservabilityService.js';

export async function createServer({ telephony, port = 3000 }) {
  const app = Fastify({ logger: true });
  await app.register(fastifyWs);
  attachObservabilityWebSocket(app);

  // URL-encoded body parser for Twilio webhooks
  app.addContentTypeParser('application/x-www-form-urlencoded', (req, payload, done) => {
    let body = '';
    payload.on('data', c => { body += c; });
    payload.on('end', () => {
      try { done(null, Object.fromEntries(new URLSearchParams(body))); }
      catch (err) { done(err); }
    });
  });

  // Twilio voice webhook (AMD + TwiML + pre-warm)
  app.post('/voice', telephony.webhookHandler());

  // Trigger outbound call API endpoint
  app.post('/api/call', async (req, reply) => {
    const { to, context } = req.body || {};
    if (!to) {
      return reply.code(400).send({ error: 'Missing "to" phone number' });
    }
    try {
      const call = await telephony.createCall({ to, context });
      return { success: true, callSid: call.sid };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Twilio media stream (WebSocket)
  app.register(async (f) => {
    f.get('/media', { websocket: true }, telephony.mediaStreamHandler());
  });

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[Server] Listening on :${port}`);
  return app;
}
