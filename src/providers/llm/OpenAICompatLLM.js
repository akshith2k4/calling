// src/providers/llm/OpenAICompatLLM.js
import OpenAI from 'openai';
import { LLMProvider } from '../../core/interfaces.js';

export class OpenAICompatLLM extends LLMProvider {
  constructor({ apiKey, baseURL, model, temperature = 0, maxTokens = 100 }) {
    super();
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }

  async *stream(messages, signal) {
    const s = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    });
    for await (const chunk of s) {
      if (signal?.aborted) break;
      const t = chunk.choices[0]?.delta?.content || '';
      if (t) yield t;
    }
  }
}
