// src/core/PipelineFactory.js

import { VoicePipeline } from './VoicePipeline.js';
import { CostTracker } from './CostTracker.js';

import { ElevenLabsSTT } from '../providers/stt/ElevenLabsSTT.js';
import { ElevenLabsTTS } from '../providers/tts/ElevenLabsTTS.js';
import { OpenAICompatLLM } from '../providers/llm/OpenAICompatLLM.js';

// ── Registry: add new providers here ────────────────────────
const STT_REGISTRY = {
  'elevenlabs': (cfg, env) => new ElevenLabsSTT({ apiKey: env.ELEVENLABS_API_KEY, ...cfg }),
  // 'deepgram':  (cfg, env) => new DeepgramSTT({ apiKey: env.DEEPGRAM_API_KEY, ...cfg }),
};

const TTS_REGISTRY = {
  'elevenlabs': (cfg, env) => new ElevenLabsTTS({ apiKey: env.ELEVENLABS_API_KEY, ...cfg }),
  // 'cartesia':  (cfg, env) => new CartesiaTTS({ apiKey: env.CARTESIA_API_KEY, ...cfg }),
};

const LLM_REGISTRY = {
  'openai-compat': (cfg, env) => new OpenAICompatLLM(cfg), // apiKey passed in cfg
  // 'anthropic':   (cfg, env) => new AnthropicLLM(cfg),
};

export function createPipelineFactory(agent, env, fillers) {
  return function createPipeline(contextOverride) {
    const sttConfig = {
      ...agent.providers.stt,
      language: contextOverride?.language || agent.providers.stt.language
    };

    const stt = STT_REGISTRY[sttConfig.name](sttConfig, env);
    const tts = TTS_REGISTRY[agent.providers.tts.name](agent.providers.tts, env);
    const llm = LLM_REGISTRY[agent.providers.llm.name](agent.providers.llm, env);
    const cost = new CostTracker(agent.costTracking);

    const dynamicAgent = contextOverride
      ? { ...agent, context: { ...agent.context, ...contextOverride } }
      : agent;

    return new VoicePipeline({ stt, tts, llm, agent: dynamicAgent, cost, fillers });
  };
}
