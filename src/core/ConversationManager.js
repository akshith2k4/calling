// src/core/ConversationManager.js

export class ConversationManager {
  constructor({ systemPrompt, maxHistory = 12 }) {
    this.systemPrompt = systemPrompt;
    this.maxHistory = maxHistory;
    this.messages = [{ role: 'system', content: systemPrompt }];
  }

  pushUser(text) {
    this.messages.push({ role: 'user', content: text });
  }

  pushAssistant(text) {
    this.messages.push({ role: 'assistant', content: text });
  }

  truncate() {
    if (this.messages.length > this.maxHistory) {
      this.messages = [this.messages[0], ...this.messages.slice(-(this.maxHistory - 1))];
    }
  }

  getMessages() {
    return this.messages;
  }

  toJSON() {
    return JSON.stringify(this.messages);
  }

  reset() {
    this.messages = [{ role: 'system', content: this.systemPrompt }];
  }
}
