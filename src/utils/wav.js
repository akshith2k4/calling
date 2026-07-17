// src/utils/wav.js

/**
 * Injects a 44-byte WAV header for 8kHz, 8-bit, mono µ-law audio.
 * @param {Buffer} rawAudioBuffer - The raw µ-law audio bytes from Twilio
 * @returns {Buffer} - A perfectly valid WAV file buffer
 */
export function createWavBuffer(rawAudioBuffer) {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 8;
  const audioFormat = 7; // 7 = µ-law. (DO NOT USE 1, which is PCM)
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const chunkSize = 36 + rawAudioBuffer.length;
  const subChunkSize = rawAudioBuffer.length;

  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write('WAVE', 8);

  // fmt subchunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);         // Subchunk1 size for PCM/µ-law
  header.writeUInt16LE(audioFormat, 20); // 7 = µ-law
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  header.write('data', 36);
  header.writeUInt32LE(subChunkSize, 40);

  return Buffer.concat([header, rawAudioBuffer]);
}

