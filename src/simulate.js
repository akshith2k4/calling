// src/simulate.js
import readline from 'readline';
import dotenv from 'dotenv';
import { ConversationManager } from './core/ConversationManager.js';
import { OpenAICompatLLM } from './providers/llm/OpenAICompatLLM.js';
import { linenGrassReminderAgent } from './agents/linenGrassReminder.js';
import { orderStatusAgent } from './agents/orderStatus.js';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const agents = {
  reminder: linenGrassReminderAgent,
  status: orderStatusAgent
};

async function selectAgent() {
  return new Promise((resolve) => {
    rl.question('Select agent to test (1 for linengrass-reminder, 2 for order-status) [1]: ', (answer) => {
      if (answer.trim() === '2') {
        resolve('status');
      } else {
        resolve('reminder');
      }
    });
  });
}

async function main() {
  const agentKey = await selectAgent();
  const agent = agents[agentKey];
  console.log(`\n--- Simulating Agent: ${agent.name} ---`);
  
  // Set up context
  const context = {
    hotelName: "Grand Hyatt Hotel",
    contactName: "Akshith",
    lastOrder: {
      id: "ORD-7762",
      date: "July fifth",
      products: "fifty white towels and thirty bedsheets"
    }
  };

  const systemPrompt = typeof agent.systemPrompt === 'function'
    ? agent.systemPrompt(context)
    : agent.systemPrompt;

  const conversation = new ConversationManager({
    systemPrompt,
    maxHistory: 12
  });

  const llm = new OpenAICompatLLM({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    model: agent.llm?.model || 'llama-3.3-70b-versatile',
    temperature: agent.llm?.temperature || 0,
    maxTokens: agent.llm?.maxTokens || 100
  });

  const greetingText = typeof agent.greeting === 'function'
    ? agent.greeting(context)
    : agent.greeting;

  conversation.pushAssistant(greetingText);
  console.log(`\nBot Greeting: \x1b[32m"${greetingText}"\x1b[0m\n`);

  const promptUser = () => {
    rl.question('\nYou: ', async (userInput) => {
      const input = userInput.trim();
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log('Exiting simulation...');
        rl.close();
        return;
      }

      if (!input) {
        promptUser();
        return;
      }

      conversation.pushUser(input);
      process.stdout.write('Bot: \x1b[32m');

      try {
        let fullResponse = '';
        const stream = llm.stream(conversation.getMessages());
        for await (const chunk of stream) {
          process.stdout.write(chunk);
          fullResponse += chunk;
        }
        process.stdout.write('\x1b[0m\n');
        conversation.pushAssistant(fullResponse);
      } catch (err) {
        console.log(`\x1b[31m\n[Error] LLM request failed: ${err.message}\x1b[0m`);
      }

      promptUser();
    });
  };

  promptUser();
}

main();
