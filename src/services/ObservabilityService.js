import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// Create pool if DATABASE_URL is defined, otherwise fallback gracefully for testing
let pool = null;
if (config.DATABASE_URL) {
  pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });
  pool.on('error', (err) => {
    console.error('Unexpected error on idle pg client', err);
  });
} else {
  console.warn('DATABASE_URL is not set. Database operations will be mocked.');
}

const clients = new Set();

function broadcast(event) {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      try {
        client.send(message);
      } catch (err) {
        console.error('Error broadcasting event to WS client', err);
      }
    }
  }
}

export async function startCall(callSid, toNumber, agentName, timestamp = new Date()) {
  console.log(`[Observability] startCall: ${callSid}, ${toNumber}, ${agentName}`);
  const eventTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const event = {
    type: 'start_call',
    callSid,
    toNumber,
    agentName,
    startedAt: eventTime.toISOString()
  };
  broadcast(event);

  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO calls (call_sid, to_number, status, started_at, agent_name) 
       VALUES ($1, $2, 'in-progress', $3, $4)
       ON CONFLICT (call_sid) DO UPDATE 
       SET to_number = EXCLUDED.to_number, status = 'in-progress', agent_name = EXCLUDED.agent_name`,
      [callSid, toNumber, eventTime, agentName]
    );
  } catch (err) {
    console.error('Error inserting call into DB:', err);
  }
}

export async function endCall(callSid, duration, recordingUrl, transcript, totalCost, costBreakdown) {
  console.log(`[Observability] endCall: ${callSid}, duration: ${duration}, url: ${recordingUrl}, cost: ${totalCost}`);
  const event = {
    type: 'end_call',
    callSid,
    durationSecs: duration,
    recordingUrl,
    transcript,
    totalCost,
    costBreakdown,
    endedAt: new Date().toISOString()
  };
  broadcast(event);

  if (!pool) return;
  try {
    await pool.query(
      `UPDATE calls 
       SET status = 'completed', ended_at = NOW(), duration_secs = $1, recording_url = $2, transcript = $3, total_cost = $4, cost_breakdown = $5
       WHERE call_sid = $6`,
      [duration, recordingUrl, JSON.stringify(transcript), totalCost, JSON.stringify(costBreakdown), callSid]
    );
  } catch (err) {
    console.error('Error updating call in DB:', err);
  }
}

export async function logEvent(callSid, eventType, payload, timestamp = new Date()) {
  console.log(`[Observability] logEvent: ${callSid}, type: ${eventType}`);
  const eventTime = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const event = {
    type: 'call_event',
    callSid,
    eventType,
    payload,
    createdAt: eventTime.toISOString()
  };
  broadcast(event);

  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO call_events (call_sid, event_type, payload, created_at) 
       VALUES ($1, $2, $3, $4)`,
      [callSid, eventType, JSON.stringify(payload), eventTime]
    );
  } catch (err) {
    console.error('Error inserting call event into DB:', err);
  }
}

export function attachObservabilityWebSocket(server) {
  server.get('/ws/observability', { websocket: true }, (connection, req) => {
    const ws = connection.socket ?? connection;
    clients.add(ws);
    console.log(`[Observability WS] Client connected. Total clients: ${clients.size}`);
    
    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[Observability WS] Client disconnected. Total clients: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[Observability WS] Socket error', err);
      clients.delete(ws);
    });
  });
}
