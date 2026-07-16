// src/providers/stt/ElevenLabsSTT.js
import WebSocket from 'ws';
import { STTProvider } from '../../core/interfaces.js';

export class ElevenLabsSTT extends STTProvider {
  constructor({ apiKey, model, language, audioFormat, commitStrategy = 'vad',
                vadSilenceThresholdSecs, vadThreshold, minVolumeThreshold,
                onTranscript, onError }) {
    super({ onTranscript, onError });
    if (!apiKey) throw new Error('ElevenLabsSTT: apiKey is required');
    if (!model) throw new Error('ElevenLabsSTT: model is required');
    if (!audioFormat) throw new Error('ElevenLabsSTT: audioFormat is required');

    this.apiKey = apiKey;
    this.params = { model_id: model, language_code: language, audio_format: audioFormat,
                    commit_strategy: commitStrategy, vad_silence_threshold_secs: vadSilenceThresholdSecs,
                    vad_threshold: vadThreshold, min_volume_threshold: minVolumeThreshold };
    this.ws = null;
    this.pingTimer = null;
    this.audioQueue = [];
    this.isClosedExplicitly = false;
  }

  connect() {
    this.isClosedExplicitly = false;
    const cleanParams = Object.fromEntries(
      Object.entries(this.params).filter(([_, val]) => val !== undefined && val !== null && val !== '')
    );
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${new URLSearchParams(cleanParams)}`;
    console.log(`[STT] Connecting: ${url}`);
    this.ws = new WebSocket(url, { headers: { 'xi-api-key': this.apiKey } });

    this.ws.on('open', () => {
      console.log('[STT] Connected');
      while (this.audioQueue.length) this.ws.send(this.audioQueue.shift());
      this.pingTimer = setInterval(() => {
        try { if (this.ws?.readyState === 1) this.ws.ping(); } catch {}
      }, 15000);
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.message_type === 'committed_transcript' && msg.text)
          this.onTranscript?.(msg.text, true, msg);
        if (msg.message_type === 'partial_transcript' && msg.text)
          this.onTranscript?.(msg.text, false, msg);
      } catch (err) {
        console.error('[STT] Parse error:', err);
      }
    });

    this.ws.on('close', (code) => {
      console.log(`[STT] Closed: ${code}`);
      clearInterval(this.pingTimer);
      if (!this.isClosedExplicitly && (code === 1006 || code === 1005)) {
        console.log('[STT] Reconnecting in 1s...');
        setTimeout(() => this.connect(), 1000);
      }
    });

    this.ws.on('error', (e) => {
      console.error('[STT] Error:', e.message);
      this.onError?.(e);
    });
  }

  sendAudio(b64) {
    const payload = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64 });
    if (this.ws?.readyState === 1) this.ws.send(payload);
    else this.audioQueue.push(payload);
  }

  close() {
    this.isClosedExplicitly = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
