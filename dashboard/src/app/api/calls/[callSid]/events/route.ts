import { NextResponse } from 'next/server';
import pg from 'pg';

const { Pool } = pg;

let pool: any = null;
const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ callSid: string }> }
) {
  const { callSid } = await params;
  if (!pool) {
    return NextResponse.json([]);
  }

  try {
    const result = await pool.query(
      `SELECT id, call_sid, event_type, payload, created_at 
       FROM call_events 
       WHERE call_sid = $1 
       ORDER BY created_at ASC`,
      [callSid]
    );
    return NextResponse.json(result.rows);
  } catch (err: any) {
    console.error(`Failed to fetch call events for ${callSid}:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
