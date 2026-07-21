// src/core/FillerManager.js

export class FillerManager {
  constructor({ fillers = [], prefetchFn }) {
    this.fillers = fillers;
    this.prefetchFn = prefetchFn;
    this.cache = {};
  }

  async prewarm() {
    if (!this.fillers.length || !this.prefetchFn) return;
    console.log('[Filler Cache] Pre-warming fillers...');
    for (const text of this.fillers) {
      try {
        this.cache[text] = await this.prefetchFn(text);
        console.log(`[Filler Cache] Cached: "${text}" (${this.cache[text].length} bytes)`);
      } catch (err) {
        console.error(`[Filler Cache] Failed to cache "${text}":`, err.message);
      }
    }
  }

  getRandom(exclude) {
    if (!this.fillers || this.fillers.length === 0) return undefined;
    const available = this.fillers.filter(f => f !== exclude);
    if (available.length === 0) return this.fillers[0];
    return available[Math.floor(Math.random() * available.length)];
  }

  get(text) {
    return this.cache[text];
  }

  async prewarmText(text) {
    if (!this.prefetchFn) return;
    try {
      this.cache[text] = await this.prefetchFn(text);
      console.log(`[Filler Cache] Custom Pre-warmed: "${text}" (${this.cache[text].length} bytes)`);
    } catch (err) {
      console.error(`[Filler Cache] Failed to cache custom text "${text}":`, err.message);
    }
  }
}
