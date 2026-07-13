import WebSocket from 'ws';

export class ElevenLabsSTT {
  constructor({ apiKey, onTranscript, onError }) {
    this.apiKey = apiKey;
    this.onTranscript = onTranscript;
    this.onError = onError;
    this.ws = null;
    this.pingTimer = null;
    this.audioQueue = [];
    this.isClosedExplicitly = false;
  }

  connect() {
    this.isClosedExplicitly = false;
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&language_code=en&audio_format=ulaw_8000&commit_strategy=vad&vad_silence_threshold_secs=1.2&vad_threshold=0.6&min_volume_threshold=0.25`;
    console.log(`[STT] Connecting to URL: ${url}`);
    this.ws = new WebSocket(url, { headers: { 'xi-api-key': this.apiKey } });

    this.ws.on('open', () => {
      console.log('[STT] WebSocket connected');
      // Send any buffered audio chunks that arrived before the connection opened
      while (this.audioQueue.length) {
        this.ws.send(this.audioQueue.shift());
      }
      
      this.pingTimer = setInterval(() => {
        try {
          if (this.ws?.readyState === 1) this.ws.ping();
        } catch {}
      }, 15000);
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.message_type === 'committed_transcript' && msg.text) {
          this.onTranscript(msg.text, true, msg);
        }
        if (msg.message_type === 'partial_transcript' && msg.text) {
          this.onTranscript(msg.text, false, msg);
        }
      } catch (err) {
        console.error('[STT] Failed to parse message:', err);
      }
    });

    this.ws.on('close', (code) => {
      console.log(`[STT] WebSocket closed with code: ${code}`);
      clearInterval(this.pingTimer);
      if (!this.isClosedExplicitly && (code === 1006 || code === 1005)) {
        console.log('[STT] Reconnecting in 1s...');
        setTimeout(() => this.connect(), 1000);
      }
    });

    this.ws.on('error', (e) => {
      console.error('[STT] WebSocket error:', e);
      this.onError?.(e);
    });
  }

  sendAudio(b64) {
    const payload = JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: b64
    });
    if (this.ws?.readyState === 1) {
      this.ws.send(payload);
    } else {
      this.audioQueue.push(payload);
    }
  }

  close() {
    this.isClosedExplicitly = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
