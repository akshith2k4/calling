'use client';

import { useState, useEffect, useRef } from 'react';

interface Call {
  call_sid: string;
  to_number: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_secs: number | null;
  recording_url: string | null;
  transcript: any;
  total_cost: number;
  agent_name: string;
  cost_breakdown?: any;
}

interface CallEvent {
  id: number;
  call_sid: string;
  event_type: string;
  payload: any;
  created_at: string;
}

export default function Dashboard() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [callEvents, setCallEvents] = useState<CallEvent[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const activeCallRef = useRef<string | null>(null);

  // Fetch initial calls
  const fetchCalls = async () => {
    try {
      const res = await fetch('/api/calls');
      if (res.ok) {
        const data = await res.json();
        setCalls(data);
      }
    } catch (err) {
      console.error('Error fetching calls:', err);
    }
  };

  useEffect(() => {
    fetchCalls();
  }, []);

  // Fetch events for selected call
  useEffect(() => {
    if (!selectedCall) return;
    activeCallRef.current = selectedCall.call_sid;
    setLoadingEvents(true);

    const fetchEvents = async () => {
      try {
        const res = await fetch(`/api/calls/${selectedCall.call_sid}/events`);
        if (res.ok) {
          const data = await res.json();
          if (activeCallRef.current === selectedCall.call_sid) {
            setCallEvents(data);
          }
        }
      } catch (err) {
        console.error('Error fetching events:', err);
      } finally {
        if (activeCallRef.current === selectedCall.call_sid) {
          setLoadingEvents(false);
        }
      }
    };

    fetchEvents();
  }, [selectedCall]);

  // Connect WebSocket for live events
  useEffect(() => {
    setWsStatus('connecting');
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000/ws/observability';
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'start_call') {
          const newCall: Call = {
            call_sid: data.callSid,
            to_number: data.toNumber,
            status: 'in-progress',
            started_at: data.startedAt,
            ended_at: null,
            duration_secs: null,
            recording_url: null,
            transcript: [],
            total_cost: 0,
            agent_name: data.agentName,
          };
          setCalls((prev) => [newCall, ...prev.filter(c => c.call_sid !== data.callSid)]);
        } else if (data.type === 'end_call') {
          const updatedFields = {
            status: 'completed',
            ended_at: data.endedAt,
            duration_secs: data.durationSecs,
            recording_url: typeof data.recordingUrl === 'string' ? data.recordingUrl : JSON.stringify(data.recordingUrl),
            transcript: data.transcript,
            total_cost: Number(data.totalCost) || 0,
            cost_breakdown: data.costBreakdown,
          };

          setCalls((prev) =>
            prev.map((c) => (c.call_sid === data.callSid ? { ...c, ...updatedFields } : c))
          );

          setSelectedCall((curr) => {
            if (curr && curr.call_sid === data.callSid) {
              return { ...curr, ...updatedFields };
            }
            return curr;
          });
        } else if (data.type === 'call_event') {
          const newEvent: CallEvent = {
            id: Date.now(),
            call_sid: data.callSid,
            event_type: data.eventType,
            payload: data.payload,
            created_at: data.createdAt,
          };

          if (activeCallRef.current === data.callSid) {
            setCallEvents((prev) => [...prev, newEvent]);
          }
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      setTimeout(() => {
        setWsStatus('connecting');
      }, 5000);
    };

    return () => {
      ws.close();
    };
  }, []);

  const getRecordingUrls = (recordingUrl: string | null) => {
    if (!recordingUrl) return { customer: null, bot: null };
    try {
      const parsed = JSON.parse(recordingUrl);
      return {
        customer: parsed.customer || parsed.customerUrl || null,
        bot: parsed.bot || parsed.botUrl || null,
      };
    } catch {
      return { customer: recordingUrl, bot: null };
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f4f4f5] font-sans antialiased selection:bg-indigo-500/30 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40 shrink-0">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <span className="text-white font-bold text-lg">L</span>
            </div>
            <div>
              <h1 className="font-semibold text-lg tracking-tight">LinenGrass Observability</h1>
              <p className="text-xs text-zinc-400">Live Voice Agent Metrics</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={fetchCalls}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 text-sm hover:bg-zinc-800 transition-all cursor-pointer"
            >
              Refresh
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800">
              <span className={`h-2.5 w-2.5 rounded-full ${
                wsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
                wsStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
              }`} />
              <span className="text-xs font-medium text-zinc-300">
                {wsStatus === 'connected' ? 'Connected' :
                 wsStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Conditional Layout Rendering */}
      {!selectedCall ? (
        /* ─── MAIN FEED VIEW ─── */
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
          {/* Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 shadow-sm hover:border-zinc-700/80 transition-all">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Total Calls</span>
              <div className="text-3xl font-bold mt-2">{calls.length}</div>
            </div>
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 shadow-sm hover:border-zinc-700/80 transition-all">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Active Call Volume</span>
              <div className="text-3xl font-bold mt-2 flex items-center gap-2">
                {calls.filter(c => c.status === 'in-progress').length}
                {calls.filter(c => c.status === 'in-progress').length > 0 && (
                  <span className="h-3 w-3 bg-red-500 rounded-full animate-ping" />
                )}
              </div>
            </div>
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 shadow-sm hover:border-zinc-700/80 transition-all">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Average Duration</span>
              <div className="text-3xl font-bold mt-2">
                {calls.filter(c => c.duration_secs).length > 0
                  ? `${Math.round(calls.reduce((acc, c) => acc + (c.duration_secs || 0), 0) / calls.filter(c => c.duration_secs).length)}s`
                  : '0s'}
              </div>
            </div>
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 shadow-sm hover:border-zinc-700/80 transition-all">
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Total Pipeline Cost</span>
              <div className="text-3xl font-bold mt-2 text-indigo-400">
                ${calls.reduce((acc, c) => acc + Number(c.total_cost), 0).toFixed(4)}
              </div>
            </div>
          </div>

          {/* Calls Table */}
          <div className="bg-zinc-900/20 border border-zinc-800/80 rounded-xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/20">
              <h2 className="font-semibold tracking-tight">Call Stream Feed</h2>
              <span className="text-xs text-zinc-500">Showing last 50 events</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs font-semibold text-zinc-400 uppercase tracking-wider bg-zinc-950/40">
                    <th className="px-6 py-3.5">Agent</th>
                    <th className="px-6 py-3.5">Call SID</th>
                    <th className="px-6 py-3.5">To Number</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Duration</th>
                    <th className="px-6 py-3.5">Cost</th>
                    <th className="px-6 py-3.5">Started At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {calls.map((call) => (
                    <tr 
                      key={call.call_sid}
                      onClick={() => setSelectedCall(call)}
                      className="hover:bg-zinc-900/40 transition-colors cursor-pointer group"
                    >
                      <td className="px-6 py-4 font-medium text-zinc-300 group-hover:text-indigo-400 transition-colors">
                        {call.agent_name || 'unknown'}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-zinc-400">
                        {call.call_sid.substring(0, 15)}...
                      </td>
                      <td className="px-6 py-4 text-zinc-300">
                        {call.to_number}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          call.status === 'in-progress' 
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                            : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                        }`}>
                          {call.status === 'in-progress' && (
                            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                          )}
                          {call.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-zinc-300">
                        {call.duration_secs !== null ? `${call.duration_secs}s` : '-'}
                      </td>
                      <td className="px-6 py-4 text-zinc-300 font-mono text-xs">
                        ${Number(call.total_cost).toFixed(4)}
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        {new Date(call.started_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                  {calls.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-zinc-500">
                        No calls logged yet. Initiate a call to trigger events!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      ) : (
        /* ─── FULL PAGE WORKSPACE VIEW ─── */
        <main className="flex-1 flex flex-col min-h-0 bg-[#09090b]">
          {/* Workspace Subheader */}
          <div className="border-b border-zinc-800 bg-zinc-950/40 px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => {
                  setSelectedCall(null);
                  activeCallRef.current = null;
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-sm font-medium transition-colors cursor-pointer"
              >
                <span>&larr;</span> Back to Feed
              </button>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="font-semibold text-base tracking-tight">{selectedCall.agent_name} Call Workspace</h2>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                    selectedCall.status === 'in-progress' 
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                      : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                  }`}>
                    {selectedCall.status === 'in-progress' && (
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                    )}
                    {selectedCall.status}
                  </span>
                </div>
                <p className="text-xs font-mono text-zinc-500 mt-0.5">{selectedCall.call_sid}</p>
              </div>
            </div>
            <div className="text-xs text-zinc-400">
              Started: {new Date(selectedCall.started_at).toLocaleString()}
            </div>
          </div>

          {/* Three-Column Workspace Layout */}
          <div className="flex-1 flex min-h-0 divide-x divide-zinc-800">
            
            {/* Column 1: Metadata & Audio & Cost Breakdown (Width: 1/4) */}
            <div className="w-80 shrink-0 overflow-y-auto p-5 space-y-5 flex flex-col">
              {/* Call Details Card */}
              <div className="bg-zinc-900/40 border border-zinc-800 p-4 rounded-xl space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Call Metadata</h3>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between border-b border-zinc-800/60 pb-1.5">
                    <span className="text-zinc-500">Recipient</span>
                    <span className="font-medium text-zinc-200">{selectedCall.to_number}</span>
                  </div>
                  <div className="flex justify-between border-b border-zinc-800/60 pb-1.5">
                    <span className="text-zinc-500">Duration</span>
                    <span className="font-medium text-zinc-200">
                      {selectedCall.duration_secs !== null ? `${selectedCall.duration_secs}s` : 'Ongoing'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Total Cost</span>
                    <span className="font-semibold text-indigo-400 font-mono">${Number(selectedCall.total_cost).toFixed(5)}</span>
                  </div>
                </div>
              </div>

              {/* S3 Audio Player Card */}
              <div className="bg-zinc-900/40 border border-zinc-800 p-4 rounded-xl space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">WAV Recordings</h3>
                {selectedCall.recording_url ? (
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1 font-medium">Customer (WAV)</label>
                      {getRecordingUrls(selectedCall.recording_url).customer ? (
                        <audio 
                          src={getRecordingUrls(selectedCall.recording_url).customer || ''} 
                          controls 
                          className="w-full h-8"
                        />
                      ) : (
                        <span className="text-xs text-zinc-500">Not uploaded</span>
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1 font-medium">Bot (WAV)</label>
                      {getRecordingUrls(selectedCall.recording_url).bot ? (
                        <audio 
                          src={getRecordingUrls(selectedCall.recording_url).bot || ''} 
                          controls 
                          className="w-full h-8"
                        />
                      ) : (
                        <span className="text-xs text-zinc-500">Not uploaded</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 text-center py-5 bg-zinc-950/40 rounded-lg border border-dashed border-zinc-800">
                    Audio finalization occurs at hang up.
                  </div>
                )}
              </div>

              {/* Pricing Breakdown Card */}
              <div className="bg-zinc-900/40 border border-zinc-800 p-4 rounded-xl space-y-3 flex-1">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Detailed Cost Breakdown</h3>
                {selectedCall.cost_breakdown ? (
                  <div className="space-y-2.5 text-xs">
                    {(() => {
                      let breakdown = selectedCall.cost_breakdown;
                      if (typeof breakdown === 'string') {
                        try { breakdown = JSON.parse(breakdown); } catch { breakdown = null; }
                      }
                      if (!breakdown) return <div className="text-zinc-500">No breakdown details available.</div>;

                      return (
                        <div className="divide-y divide-zinc-800/60 space-y-2 pt-1">
                          <div className="flex justify-between py-1 text-zinc-300">
                            <span>Twilio Voice ({((breakdown.duration || 0) / 60).toFixed(2)} min)</span>
                            <span className="font-mono text-zinc-400">${Number(breakdown.twilioVoice || 0).toFixed(5)}</span>
                          </div>
                          <div className="flex justify-between py-1 text-zinc-300">
                            <span>Twilio Media Stream</span>
                            <span className="font-mono text-zinc-400">${Number(breakdown.twilioStream || 0).toFixed(5)}</span>
                          </div>
                          <div className="flex justify-between py-1 text-zinc-300">
                            <span>Speech-to-Text (STT)</span>
                            <span className="font-mono text-zinc-400">${Number(breakdown.stt || 0).toFixed(5)}</span>
                          </div>
                          <div className="flex justify-between py-1 text-zinc-300">
                            <span>LLM Input ({breakdown.llmInputTokens || 0} tkn)</span>
                            <span className="font-mono text-zinc-400">${Number(breakdown.llmIn || 0).toFixed(5)}</span>
                          </div>
                          <div className="flex justify-between py-1 text-zinc-300">
                            <span>LLM Output ({breakdown.llmOutputTokens || 0} tkn)</span>
                            <span className="font-mono text-zinc-400">${Number(breakdown.llmOut || 0).toFixed(5)}</span>
                          </div>
                          <div className="flex justify-between py-1 text-zinc-300">
                            <span>Text-to-Speech ({breakdown.ttsChars || 0} chr)</span>
                            <span className="font-mono text-zinc-400">${Number(breakdown.tts || 0).toFixed(5)}</span>
                          </div>
                          <div className="flex justify-between py-2.5 font-bold text-indigo-400 border-t border-zinc-700 pt-3 text-sm">
                            <span>Total cost</span>
                            <span className="font-mono">${Number(breakdown.total || selectedCall.total_cost || 0).toFixed(5)}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 text-center py-5 bg-zinc-950/20 rounded border border-dashed border-zinc-800">
                    Breakdown calculates when the call completes.
                  </div>
                )}
              </div>
            </div>

            {/* Column 2: Live Chat Messenger (Width: 2/4 - flex-1) */}
            <div className="flex-1 flex flex-col min-w-0 bg-zinc-950/20">
              <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-950/30 flex justify-between items-center shrink-0">
                <h3 className="text-sm font-semibold tracking-tight">Conversation Transcript</h3>
                <span className="text-xs text-zinc-500">Live updating</span>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {(() => {
                  let messages = [];
                  try {
                    messages = typeof selectedCall.transcript === 'string'
                      ? JSON.parse(selectedCall.transcript)
                      : selectedCall.transcript || [];
                  } catch {
                    messages = [];
                  }

                  if (messages.length === 0) {
                    return (
                      <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
                        Waiting for conversational speech...
                      </div>
                    );
                  }

                  return messages.filter((m: any) => m.role !== 'system').map((msg: any, i: number) => (
                    <div 
                      key={i} 
                      className={`flex flex-col max-w-[70%] ${
                        msg.role === 'user' ? 'mr-auto items-start' : 'ml-auto items-end'
                      }`}
                    >
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">
                        {msg.role === 'user' ? 'Customer' : 'Bot Agent'}
                      </span>
                      <div 
                        className={`p-3.5 rounded-2xl text-sm leading-relaxed ${
                          msg.role === 'user' 
                            ? 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none' 
                            : 'bg-indigo-600/10 border border-indigo-500/20 text-zinc-100 rounded-tr-none shadow-md shadow-indigo-500/5'
                        }`}
                      >
                        <p>{msg.content}</p>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Column 3: Live Telemetry Event Timeline (Width: 1/4) */}
            <div className="w-96 shrink-0 flex flex-col">
              <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-950/30 flex justify-between items-center shrink-0">
                <h3 className="text-sm font-semibold tracking-tight">Telemetry Timeline</h3>
                <span className="text-xs text-zinc-500">Latency milestones</span>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {loadingEvents ? (
                  <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Loading events...</div>
                ) : callEvents.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Waiting for telemetry...</div>
                ) : (
                  <div className="relative pl-4 border-l border-zinc-800 space-y-5">
                    {callEvents.map((evt, idx) => {
                      const date = new Date(evt.created_at || evt.id);
                      const timeStr = date.toLocaleTimeString(undefined, { hour12: false });
                      
                      let badgeColor = 'bg-zinc-800 text-zinc-400 border border-zinc-700/60';
                      let desc = '';

                      if (evt.event_type === 'stt_connect') {
                        badgeColor = 'bg-teal-500/10 text-teal-400 border border-teal-500/20';
                        desc = 'Connected Speech-to-Text provider';
                      } else if (evt.event_type === 'stt_final') {
                        badgeColor = 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
                        desc = `STT: "${evt.payload?.text || ''}"` + 
                               (evt.payload?.estimatedVadMs ? ` (VAD Silence Buffer: ${evt.payload.estimatedVadMs}ms)` : '');
                      } else if (evt.event_type === 'ttft') {
                        badgeColor = 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
                        desc = `TTFT (Time-to-First-Token): ${evt.payload?.latency || 0}ms`;
                      } else if (evt.event_type === 'llm_response') {
                        badgeColor = 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
                        desc = `LLM Response: "${evt.payload?.text || ''}"`;
                      } else if (evt.event_type === 'barge_in') {
                        badgeColor = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                        desc = `Barge-In triggered by: "${evt.payload?.text || ''}"`;
                      } else if (evt.event_type === 'tts_first_byte') {
                        badgeColor = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                        desc = `TTS First Byte: ${evt.payload?.latency || 0}ms (${evt.payload?.type || ''})`;
                      } else if (evt.event_type === 'true_voice_latency') {
                        badgeColor = 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
                        desc = `True Voice Latency: ${evt.payload?.ms || 0}ms` +
                               (evt.payload?.fillerPlayed && evt.payload?.fillerMs ? ` + Filler: ${evt.payload.fillerMs}ms (Perceived Silence-to-Speech: ${evt.payload.perceivedMs}ms)` : '');
                      } else if (evt.event_type === 'call_outcome') {
                        badgeColor = 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
                        desc = `Call Outcome Status: "${evt.payload?.status || ''}"` +
                               (evt.payload?.details ? ` (Details: "${evt.payload.details}")` : '');
                      } else {
                        desc = evt.event_type;
                      }

                      return (
                        <div key={evt.id || idx} className="relative group">
                          {/* Circle dot on vertical line */}
                          <span className="absolute -left-[20.5px] top-1.5 h-2 w-2 rounded-full bg-zinc-800 group-hover:bg-indigo-500 transition-colors border border-zinc-950" />
                          
                          <div className="flex justify-between items-start gap-4">
                            <div className="space-y-1">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${badgeColor}`}>
                                {evt.event_type}
                              </span>
                              <p className="text-xs text-zinc-300 font-medium leading-relaxed">{desc}</p>
                            </div>
                            <span className="text-[10px] text-zinc-500 font-mono shrink-0 whitespace-nowrap mt-0.5">
                              {timeStr}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

          </div>
        </main>
      )}
    </div>
  );
}
