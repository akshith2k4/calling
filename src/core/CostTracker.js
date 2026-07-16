// src/core/CostTracker.js

export class CostTracker {
  constructor(rates = {}) {
    this.rates = {
      twilioVoicePerMin: 0.014,
      twilioStreamPerMin: 0.004,
      sttPerHour: 0.39,
      llmInputPerM: 0.05,
      llmOutputPerM: 0.08,
      ttsPer1kChars: 0.015,
      ...rates,
    };
    this.llmInputTokens = 0;
    this.llmOutputTokens = 0;
    this.ttsChars = 0;
  }

  trackLLM(messagesJson, outputText) {
    this.llmInputTokens += Math.round(messagesJson.length / 4);
    this.llmOutputTokens += Math.round(outputText.length / 4);
    this.ttsChars += outputText.length;
  }

  report(startTime) {
    if (!startTime) return;
    const dur = (Date.now() - startTime) / 1000;
    const twilioVoice = (dur / 60) * this.rates.twilioVoicePerMin;
    const twilioStream = (dur / 60) * this.rates.twilioStreamPerMin;
    const stt = (dur / 3600) * this.rates.sttPerHour;
    const llmIn = this.llmInputTokens * (this.rates.llmInputPerM / 1e6);
    const llmOut = this.llmOutputTokens * (this.rates.llmOutputPerM / 1e6);
    const tts = this.ttsChars * (this.rates.ttsPer1kChars / 1000);
    const total = twilioVoice + twilioStream + stt + llmIn + llmOut + tts;

    console.log(`
=============================================================
                     CALL COST REPORT
=============================================================
Duration:            ${dur.toFixed(1)}s
Twilio Voice:        $${twilioVoice.toFixed(5)}
Twilio Stream:       $${twilioStream.toFixed(5)}
STT:                 $${stt.toFixed(5)}
LLM Input:           ${this.llmInputTokens} tokens  $${llmIn.toFixed(5)}
LLM Output:          ${this.llmOutputTokens} tokens  $${llmOut.toFixed(5)}
TTS:                 ${this.ttsChars} chars   $${tts.toFixed(5)}
-------------------------------------------------------------
GRAND TOTAL:         $${total.toFixed(5)}
=============================================================`);
  }
}
