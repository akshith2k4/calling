import OpenAI from 'openai';
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

export async function* streamLLM(messages, signal) {
  const stream = await openai.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages,
    stream: true,
    temperature: 0,
    max_tokens: 100,
  });
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const t = chunk.choices[0]?.delta?.content || '';
    if (t) yield t;
  }
}
