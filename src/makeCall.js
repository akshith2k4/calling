import 'dotenv/config';
import twilio from 'twilio';


const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const call = await client.calls.create({
  to: process.env.TO_NUMBER,
  from: process.env.TWILIO_FROM_NUMBER,
  url: `https://${process.env.DOMAIN}/voice`,
  machineDetection: 'Enable',
  asyncAmd: 'true'
});
console.log('Calling', call.sid);
