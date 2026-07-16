// src/providers/telephony/TwilioTransport.js
import { EventEmitter } from 'events';

export class TwilioTransport extends EventEmitter {
  constructor(ws, streamSid) {
    super();
    this.ws = ws;
    this.streamSid = streamSid;
  }

  _send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  sendMedia(b64) {
    this.emit('outboundMedia', b64);
    this._send({ event: 'media', streamSid: this.streamSid, media: { payload: b64 } });
  }

  sendMark(name) {
    this._send({ event: 'mark', streamSid: this.streamSid, mark: { name } });
  }

  sendClear() {
    this._send({ event: 'clear', streamSid: this.streamSid });
  }
}
