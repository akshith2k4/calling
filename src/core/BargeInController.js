// src/core/BargeInController.js

const DEFAULT_BACKCHANNELS = ['mm', 'yeah', 'okay', 'uh', 'hmm', 'ah'];

export class BargeInController {
  constructor({
    greetingDurationMs = 2500,
    lockMs = 800,
    minWords = 2,
    minLength = 12,
    speechStartMs = 800,
    postBotLockMs = 600,
    backchannels = DEFAULT_BACKCHANNELS,
  } = {}) {
    this.greetingDurationMs = greetingDurationMs;
    this.lockMs = lockMs;
    this.minWords = minWords;
    this.minLength = minLength;
    this.speechStartMs = speechStartMs;
    this.postBotLockMs = postBotLockMs;
    this.backchannels = backchannels;

    this.isGreeting = false;
    this.lockUntil = 0;
    this.lastBotFinish = 0;
    this.speechStart = 0;
  }

  lockForGreeting(durationMs) {
    this.isGreeting = true;
    setTimeout(() => { this.isGreeting = false; }, durationMs ?? this.greetingDurationMs);
  }

  onBotFinished() {
    if (this.isGreeting) this.isGreeting = false;
    this.lastBotFinish = Date.now();
    this.speechStart = 0;
  }

  /**
   * Returns true if the partial transcript should trigger a barge-in.
   * @param {string} text - partial transcript
   * @param {boolean} isSpeaking - whether the bot is currently speaking
   */
  shouldBargeIn(text, isSpeaking) {
    if (this.isGreeting) return false;
    if (!isSpeaking) return false;
    if (Date.now() < this.lockUntil) return false;
    if (Date.now() - this.lastBotFinish < this.postBotLockMs) return false;

    const now = Date.now();
    if (this.speechStart === 0 || (this.lastPartialTime && now - this.lastPartialTime > 1000)) {
      this.speechStart = now;
    }
    this.lastPartialTime = now;

    if (text.length > this.minLength && now - this.speechStart > this.speechStartMs) {
      const lower = text.toLowerCase().trim();
      if (this.backchannels.includes(lower)) return false;
      if (text.trim().split(/\s+/).length < this.minWords) return false;
      return true;
    }
    return false;
  }

  recordBargeIn() {
    this.lockUntil = Date.now() + this.lockMs;
    this.speechStart = 0;
  }

  resetSpeechStart() {
    this.speechStart = 0;
    this.lastPartialTime = 0;
  }
}
