import WebSocket from 'ws';

export class ElevenLabsTTS {
  constructor({ apiKey, voiceId, onAudio, onOpen }) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.onAudio = onAudio;
    this.onOpen = onOpen;
    this.ws = null;
    this.queue = [];
    this.isClosedExplicitly = false;
    this.ignoringAudio = false;
  }

  connect() {
    this.isClosedExplicitly = false;
    this.ignoringAudio = false;
    return new Promise((resolve) => {
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_turbo_v2&output_format=ulaw_8000&optimize_streaming_latency=4&inactivity_timeout=180`;
      this.ws = new WebSocket(url, { headers: { 'xi-api-key': this.apiKey } });

      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.45, similarity_boost: 0.8 },
          generation_config: { chunk_length_schedule: [50, 90, 120], flush_after_eos: true }
        }));
        while (this.queue.length) {
          this.ws.send(this.queue.shift());
        }
        this.onOpen?.();
        resolve();
      });

      this.ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (this.ignoringAudio) {
            if (m.isFinal) {
              console.log('[TTS] Received isFinal for interrupted stream. Resuming normal audio delivery.');
              this.ignoringAudio = false;
            }
            return;
          }
          if (m.audio) {
            this.onAudio(m.audio, m.isFinal);
          }
        } catch {}
      });


      this.ws.on('close', (c) => {
        console.log(`[TTS] closed ${c}`);
        if (!this.isClosedExplicitly && (c === 1006 || c === 1005)) {
          console.log('[TTS] Reconnecting in 1s...');
          setTimeout(() => this.connect(), 1000);
        }
      });
    });
  }

  sendTextChunk(text, trigger = true) {
    const p = JSON.stringify({ text, try_trigger_generation: trigger });
    if (this.ws?.readyState === 1) {
      this.ws.send(p);
    } else {
      this.queue.push(p);
    }
  }

  interrupt(hard = false) {
    this.queue = [];
    if (hard) {
      console.log('[TTS] Hard interrupt: Closing and reconnecting socket.');
      try {
        this.ws?.close();
      } catch {}
      this.connect();
    } else {
      console.log('[TTS] Soft interrupt: Sending flush and discarding remaining audio of current stream.');
      this.ignoringAudio = true;
      if (this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ text: "", flush: true }));
      }
    }
  }

  flush() {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ text: "", flush: true }));
    }
  }

  clearInterrupt() {
    this.ignoringAudio = false;
  }

  close() {
    this.isClosedExplicitly = true;
    try {
      this.ws?.close();
    } catch {}
  }
}
