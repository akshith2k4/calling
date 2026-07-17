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

export async function GET() {
  if (!pool) {
    // Return empty mock calls if DB is not configured
    return NextResponse.json([]);
  }

  try {
    const result = await pool.query(
      `SELECT call_sid, to_number, status, started_at, ended_at, duration_secs, recording_url, transcript, total_cost, agent_name, cost_breakdown
       FROM calls 
       ORDER BY started_at DESC 
       LIMIT 50`
    );
    return NextResponse.json(result.rows);
  } catch (err: any) {
    console.error('Failed to fetch calls from DB:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
