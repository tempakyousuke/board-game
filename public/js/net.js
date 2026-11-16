// サーバーとの WebSocket 接続。切れたら自動でつなぎ直し、同じ席に戻る。

const CLOSE_REPLACED = 4001;
const CLOSE_KICKED = 4002;
const CLOSE_LEFT = 4003;
const PING_MS = 20_000;
const KEEPALIVE_MS = 4 * 60_000;

// プライベートブラウズなどでストレージが使えなくても動くようにしておく。
const memory = new Map();
function read(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(store, key, value) {
  try {
    store.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** タブごとの ID。同じブラウザで2つのタブを開いても別の人として扱われる。 */
function tabClientId() {
  let id = read(sessionStorage, 'bg.clientId');
  if (!id) {
    id = randomId();
    write(sessionStorage, 'bg.clientId', id);
  }
  return id;
}

export function getName() {
  return read(localStorage, 'bg.name') || '';
}
export function setName(name) {
  write(localStorage, 'bg.name', name);
}

export class Connection {
  /**
   * @param {{
   *   onState: (msg: object) => void,
   *   onStatus: (status: 'connecting' | 'online' | 'reconnecting' | 'closed') => void,
   *   onError: (message: string) => void,
   *   onEmote: (msg: object) => void,
   *   onGone: (reason: 'notFound' | 'error' | 'replaced' | 'kicked', message?: string) => void,
   * }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.ws = null;
    this.intent = null;
    this.code = null;
    this.retries = 0;
    this.retryTimer = null;
    this.stopped = true;

    setInterval(() => this.send({ t: 'ping' }), PING_MS);
    // 無料プランのサーバーは通信がないと眠るので、遊んでいるあいだは起こしておく。
    setInterval(() => {
      if (this.code) fetch('/healthz').catch(() => {});
    }, KEEPALIVE_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.stopped && !this.ws) this.connect();
    });
    window.addEventListener('online', () => {
      if (!this.stopped && !this.ws) this.connect();
    });
  }

  /** @param {{ type: 'create', name: string } | { type: 'join', code: string, name: string }} intent */
  open(intent) {
    this.close();
    this.intent = intent;
    this.code = intent.type === 'join' ? intent.code : null;
    this.stopped = false;
    this.retries = 0;
    this.connect();
  }

  connect() {
    clearTimeout(this.retryTimer);
    if (this.stopped) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;
    this.handlers.onStatus(this.retries > 0 ? 'reconnecting' : 'connecting');

    ws.onopen = () => {
      const clientId = tabClientId();
      const name = this.intent.name;
      if (this.code) {
        const altClientId = read(localStorage, `bg.room.${this.code}`) || undefined;
        this.send({ t: 'join', code: this.code, clientId, altClientId, name });
      } else {
        this.send({ t: 'create', clientId, name });
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.t === 'state') {
        this.code = msg.room.code;
        this.retries = 0;
        // 元の席に戻れたときは、その席の ID をこのタブでも使い続ける。
        if (msg.clientId) {
          write(sessionStorage, 'bg.clientId', msg.clientId);
          write(localStorage, `bg.room.${this.code}`, msg.clientId);
        }
        this.handlers.onStatus('online');
        this.handlers.onState(msg);
      } else if (msg.t === 'error') {
        this.handlers.onError(msg.message);
      } else if (msg.t === 'emote') {
        this.handlers.onEmote(msg);
      } else if (msg.t === 'joinFailed') {
        this.stopped = true;
        this.code = null;
        this.handlers.onGone(msg.reason, msg.message);
        ws.close();
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (event.code === CLOSE_REPLACED || event.code === CLOSE_KICKED || event.code === CLOSE_LEFT) {
        this.stopped = true;
        this.code = null;
        this.handlers.onStatus('closed');
        if (event.code === CLOSE_REPLACED) this.handlers.onGone('replaced');
        if (event.code === CLOSE_KICKED) this.handlers.onGone('kicked');
        if (event.code === CLOSE_LEFT) this.handlers.onGone('error', 'ルームが閉じられました');
        return;
      }
      this.retries++;
      this.handlers.onStatus('reconnecting');
      const delay = Math.min(8000, 500 * 2 ** Math.min(this.retries, 4));
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => {};
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  /** 自分からルームを出る。 */
  leave() {
    this.send({ t: 'leave' });
    this.close();
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    this.code = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}
