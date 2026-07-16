// src/server/makeCall.js
import { config } from '../config.js';

export async function makeCall(telephony, { to = config.TO_NUMBER } = {}) {
  const call = await telephony.createCall({ to, machineDetection: true });
  console.log('Calling', call.sid);
  return call;
}
