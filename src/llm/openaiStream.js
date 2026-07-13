import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function* streamLLM(messages, signal) {
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    stream: true,
    temperature: 0,
    max_tokens: 60,
  });
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const t = chunk.choices[0]?.delta?.content || '';
    if (t) yield t;
  }
}
