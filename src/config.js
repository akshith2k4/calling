// src/config.js
import 'dotenv/config';

export const config = {
  PORT: process.env.PORT || 3000,
  DOMAIN: process.env.DOMAIN,
  TO_NUMBER: process.env.TO_NUMBER,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
};
