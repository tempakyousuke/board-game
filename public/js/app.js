// アプリ全体の入口。URL と接続状態を見て、どの画面を出すかを決める。

import { html, render, useState, useEffect, useRef, useCallback, cx } from './lib.js';
import { Connection, getName, setName } from './net.js';
import { Toasts } from './ui.js';
import { Home } from './home.js';
import { Lobby, NameForm } from './lobby.js';
import { GameScreen } from './game.js';

function parseRoute() {
  const match = location.pathname.match(/^\/r\/([A-Za-z0-9]{4})\/?$/);
  return match ? { page: 'room', code: match[1].toUpperCase() } : { page: 'home' };
}

const GONE_TEXT = {
  notFound: {
    title: 'ルームが見つかりません',
    body: 'コードが違うか、ルームがもう閉じられています。しばらく誰もいなかったルームや、サーバーが再起動したときのルームは消えてしまいます。',
  },
  replaced: {
    title: '別のタブで開かれました',
    body: 'このルームは、同じブラウザの別のタブで開かれています。こちらのタブで続けるには「もう一度入る」を押してください。',
  },
  kicked: { title: 'ルームから外されました', body: 'ホストがあなたをメンバーから外しました。' },
  error: { title: '参加できませんでした', body: '' },
};

function App() {
  const [route, setRoute] = useState(parseRoute);
  const [snap, setSnap] = useState(null);
  const [status, setStatus] = useState('idle');
  const [gone, setGone] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [emotes, setEmotes] = useState([]);
  const [name, setNameState] = useState(getName);
  const connRef = useRef(null);
  const idRef = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;

  const notify = useCallback((text, kind = 'error') => {
    const id = ++idRef.current;
    setToasts((list) => [...list.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3500);
  }, []);

  const navigate = useCallback((path, replace = false) => {
    if (location.pathname !== path) {
      if (replace) history.replaceState(null, '', path);
      else history.pushState(null, '', path);
    }
    setRoute(parseRoute());
  }, []);

  if (!connRef.current) {
    connRef.current = new Connection({
      onState: (msg) => {
        msg.receivedAt = Date.now();
        setGone(null);
        setSnap(msg);
        // ルームを作った直後は、そのルームの URL に移る。
        const current = routeRef.current;
        if (current.page !== 'room' || current.code !== msg.room.code) navigate(`/r/${msg.room.code}`);
      },
      onStatus: setStatus,
      onError: (message) => notify(message),
      onEmote: (msg) => {
        const id = ++idRef.current;
        setEmotes((list) => [...list.filter((e) => e.playerId !== msg.playerId), { id, ...msg }]);
        setTimeout(() => setEmotes((list) => list.filter((e) => e.id !== id)), 2200);
      },
      onGone: (reason, message) => {
        setSnap(null);
        setStatus('closed');
        setGone({ reason, message });
      },
    });
  }
  const conn = connRef.current;
  const send = useCallback((msg) => {
    if (!conn.send(msg)) notify('接続が切れています。つなぎ直しています…');
  }, []);

  // ブラウザの「戻る」「進む」に合わせる。
  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // URL が指しているルームに入る。
  useEffect(() => {
    if (route.page !== 'room' || gone || !name) return;
    if (conn.code === route.code) return;
    setSnap(null);
    conn.open({ type: 'join', code: route.code, name });
  }, [route.page, route.code, name, gone]);

  // ルームの URL からトップに戻ったら、ルームを出る。
  const lastPage = useRef(route.page);
  useEffect(() => {
    const was = lastPage.current;
    lastPage.current = route.page;
    if (route.page === 'home' && was === 'room') {
      conn.leave();
      setSnap(null);
      setStatus('idle');
      setGone(null);
    }
  }, [route.page]);

  useEffect(() => {
    const title = snap ? `ルーム ${snap.room.code} — ボドゲひろば` : 'ボドゲひろば — 友達と遊べるオリジナルボードゲーム';
    document.title = title;
  }, [snap?.room.code]);

  const saveName = (value) => {
    setName(value);
    setNameState(value);
  };
  const goHome = () => {
    setGone(null);
    navigate('/');
  };
  const leave = () => {
    const playing = snap?.room.phase === 'playing' && snap.game?.seat >= 0;
    if (playing && !confirm('ゲームの途中です。ルームを出ますか？')) return;
    goHome();
  };

  let body;
  if (gone) {
    const text = GONE_TEXT[gone.reason] ?? GONE_TEXT.error;
    body = html`
      <main class="page page-center">
        <div class="card notice">
          <h2>${text.title}</h2>
          <p>${gone.message && gone.reason === 'error' ? gone.message : text.body}</p>
          <div class="row">
            ${gone.reason === 'replaced' && html`<button class="btn btn-primary" onClick=${() => setGone(null)}>もう一度入る</button>`}
            <button class=${cx('btn', gone.reason !== 'replaced' && 'btn-primary')} onClick=${goHome}>トップにもどる</button>
          </div>
        </div>
      </main>
    `;
  } else if (route.page === 'home') {
    body = html`
      <${Home}
        initialName=${name}
        busy=${status === 'connecting'}
        onCreate=${(value) => {
          saveName(value);
          conn.open({ type: 'create', name: value });
        }}
        onJoin=${(code, value) => {
          saveName(value);
          navigate(`/r/${code}`);
        }}
      />
    `;
  } else if (!name) {
    body = html`
      <main class="page page-center">
        <div class="card notice">
          <h2>ルーム ${route.code} に参加</h2>
          <p>みんなに表示される名前を入れてください。</p>
          <${NameForm} label="参加する" onSubmit=${saveName} />
        </div>
      </main>
    `;
  } else if (!snap) {
    body = html`
      <main class="page page-center">
        <div class="loading">
          <span class="spinner"></span>
          <p>ルームに接続しています…</p>
          <small>サーバーが眠っていると、起きるまで1分ほどかかることがあります。</small>
        </div>
      </main>
    `;
  } else if (snap.room.phase === 'lobby' || !snap.game) {
    body = html`<${Lobby} snap=${snap} send=${send} notify=${notify} />`;
  } else {
    body = html`<${GameScreen} snap=${snap} send=${send} emotes=${emotes} />`;
  }

  const inGame = !!snap?.game && snap.room.phase !== 'lobby';
  return html`
    <header class=${cx('topbar', inGame && 'topbar-compact')}>
      <a
        class="logo"
        href="/"
        onClick=${(e) => {
          e.preventDefault();
          if (route.page === 'home') return;
          if (snap) leave();
          else goHome();
        }}
      >
        <img src="/favicon.svg" alt="" width="28" height="28" />
        <span>ボドゲひろば</span>
      </a>
      ${snap &&
      html`
        <div class="topbar-room">
          <span class=${cx('conn', `conn-${status}`)} title=${status === 'online' ? '接続中' : 'つなぎ直しています'}></span>
          <span class="room-chip">${snap.room.code}</span>
          <button class="btn btn-small" onClick=${leave}>退出</button>
        </div>
      `}
    </header>
    ${snap && status === 'reconnecting' && html`<div class="reconnect-bar">接続が切れました。つなぎ直しています…</div>`}
    ${body}
    <${Toasts} items=${toasts} />
  `;
}

const rootEl = document.getElementById('app');
rootEl.textContent = '';
render(html`<${App} />`, rootEl);
