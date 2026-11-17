// ゲーム中の画面の枠。プレイヤー一覧・結果・ホスト用の操作をまとめ、
// 盤面そのものは games/ 以下の各ゲームの部品に任せる。

import { html, useState, useEffect, cx } from './lib.js';
import { Avatar, Modal, medal, paletteOf } from './ui.js';
import { GAME_UI } from './games/index.js';

const STALL_MS = 40_000;
const EMOTES = ['👍', '😂', '😱', '🎉', '🤔', '🙏'];

function useNow(intervalMs) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function RulesModal({ gameId, onClose }) {
  const ui = GAME_UI[gameId];
  return html`
    <${Modal} title=${`${ui.meta.name} のルール`} onClose=${onClose} wide>
      <${ui.Rules} />
    <//>
  `;
}

function PlayerStrip({ snap, players, emotes, send }) {
  const { game, room, you } = snap;
  const ui = GAME_UI[game.id];
  const view = game.view;
  const scores = ui.scores(view);
  const isHost = room.hostId === you;
  // サーバーとの時計のずれを見込んで、待ち時間を測る。
  const now = useNow(5000);
  const waited = now - snap.receivedAt + (snap.now - game.since);
  const simultaneous = ui.waiting(view);
  // 「次へ」を待っているだけの場面など、だれの番でもないときは強調しない。
  const turnSeats = ui.turnSeats ? ui.turnSeats(view, game.pending) : game.pending;

  return html`
    <div class=${cx('strip', players.length >= 5 && 'is-dense')}>
      ${players.map((player, s) => {
        const pending = turnSeats.includes(s);
        const isMe = s === game.seat;
        const stalled = pending && !player.bot && !isMe && (!player.connected || waited > STALL_MS);
        const winner = view.over && view.result.winners.includes(s);
        const emote = emotes.find((e) => e.playerId === player.id);
        return html`
          <div
            key=${player.id}
            class=${cx('strip-player', pending && !view.over && 'is-pending', isMe && 'is-me', winner && 'is-winner', !player.connected && 'is-away')}
            style=${`--c:${paletteOf(player).color};--soft:${paletteOf(player).soft}`}
          >
            <${Avatar} player=${player} size=${players.length >= 5 ? 'sm' : 'md'} active=${pending && !view.over} />
            <span class="strip-text">
              <span class="strip-name">${player.name}</span>
              <span class="strip-extra">
                ${!player.connected ? '切断中…' : ui.extra(view, s)}
                ${simultaneous && player.connected && html` ${pending ? '🤔' : '✅'}`}
              </span>
            </span>
            ${scores && html`<span class="strip-score"><b>${scores[s]}</b><small>${ui.unit}</small></span>`}
            ${isMe && html`<span class="strip-you">あなた</span>`}
            ${emote && html`<span key=${emote.id} class="emote-pop">${emote.emoji}</span>`}
            ${stalled &&
            isHost &&
            html`<button class="strip-cpu" onClick=${() => send({ t: 'cpuMove', playerId: player.id })}>CPU に1手まかせる</button>`}
          </div>
        `;
      })}
    </div>
  `;
}

function ResultCard({ snap, players, send }) {
  const { game, room, you } = snap;
  const { result } = game.view;
  const isHost = room.hostId === you;
  const order = players.map((_, s) => s).sort((a, b) => result.places[a] - result.places[b]);
  const iWon = result.winners.includes(game.seat);
  const winnerNames = result.winners.map((s) => players[s].name).join(' さん・');

  // 複数人が1位のとき: チーム戦なら「あなたたち」、個人戦なら同率。
  const winTitle = result.winners.length === 1 ? 'あなたの勝ち！' : result.roles ? 'あなたたちの勝ち！' : '同率1位！';

  const hostButtons = isHost
    ? html`
        <div class="row">
          <button class="btn btn-primary" onClick=${() => send({ t: 'rematch' })}>もう一度あそぶ</button>
          <button class="btn" onClick=${() => send({ t: 'toLobby' })}>ほかのゲームをえらぶ</button>
        </div>
      `
    : html`<p class="muted">ホストが次のゲームを選ぶのを待っています…</p>`;

  // 協力ゲームは順位がないので、全員の結果を1つだけ出す。
  if (result.coop) {
    return html`
      <section class=${cx('result', !result.success && 'is-lost')}>
        <h2>${result.success ? '🎉 みんなの勝ち！' : '😢 ざんねん…'}</h2>
        ${result.success && html`<p class="result-stars" aria-label=${`星${result.stars}つ`}>${'★'.repeat(result.stars)}<span>${'★'.repeat(3 - result.stars)}</span></p>`}
        <p class="result-headline">${result.headline}</p>
        ${hostButtons}
      </section>
    `;
  }

  return html`
    <section class="result">
      <h2>${iWon ? `🎉 ${winTitle}` : `🏆 ${winnerNames} さんの勝ち！`}</h2>
      ${result.headline && html`<p class="result-headline">${result.headline}</p>`}
      <ol class="result-list">
        ${order.map(
          (s) => html`
            <li key=${s} class=${cx(result.places[s] === 1 && 'is-first')}>
              <span class="result-place">${medal(result.places[s])}</span>
              <${Avatar} player=${players[s]} size="sm" />
              <span class="result-name">${players[s].name}</span>
              <span class="result-score">${result.roles ? result.roles[s] : html`<b>${result.scores[s]}</b> ${result.unit}`}</span>
            </li>
          `,
        )}
      </ol>
      ${hostButtons}
    </section>
  `;
}

export function GameScreen({ snap, send, emotes }) {
  const { game, room, you } = snap;
  const ui = GAME_UI[game.id];
  const view = game.view;
  const [showRules, setShowRules] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const isHost = room.hostId === you;
  const me = room.players.find((p) => p.id === you);
  const players = game.seats.map(
    (id) => room.players.find((p) => p.id === id) ?? { id, name: '（退出）', color: -1, connected: false, bot: false },
  );
  const act = (action) => send({ t: 'action', action });
  const progress = ui.progress(view);
  const turnSeats = ui.turnSeats ? ui.turnSeats(view, game.pending) : game.pending;
  const myTurn = !view.over && turnSeats.includes(game.seat);

  // 別のアプリで話しているあいだに番が来ても気づけるよう、タブの題名と振動で知らせる。
  useEffect(() => {
    if (!myTurn) return undefined;
    const before = document.title;
    document.title = `● あなたの番です — ${ui.meta.name}`;
    if (document.visibilityState === 'hidden') navigator.vibrate?.(120);
    return () => {
      document.title = before;
    };
  }, [myTurn, game.no]);
  const watching = game.seat < 0;
  const vacant = watching ? players.filter((p) => !p.connected && !p.bot && p.color >= 0) : [];
  const watchers = room.players.filter((p) => !game.seats.includes(p.id));

  return html`
    <main class="page page-game">
      <div class="game-head">
        <div class="game-head-title">
          <h1>${ui.meta.name}</h1>
          ${progress && !view.over && html`<span class="pill pill-strong">${progress}</span>`}
        </div>
        <span class="game-head-actions">
          <button class="btn btn-small" onClick=${() => setShowRules(true)} aria-label="ルール">📖<span class="btn-label"> ルール</span></button>
          ${isHost && html`<button class="btn btn-small" onClick=${() => setShowMenu(true)} aria-label="ホストメニュー">⚙️</button>`}
        </span>
      </div>

      ${watching &&
      html`
        <div class="banner">
          👀 観戦中です。
          ${vacant.length > 0
            ? vacant.map(
                (p) => html`
                  <button key=${p.id} class="btn btn-small" onClick=${() => send({ t: 'takeover', playerId: p.id })}>
                    ${p.name} さんの席を引き継ぐ
                  </button>
                `,
              )
            : room.phase === 'finished'
              ? html`<button class="btn btn-small" onClick=${() => send({ t: 'setSpectator', value: !me?.spectator })}>
                  ${me?.spectator ? '次のゲームから参加する' : '次も観戦する'}
                </button>`
              : '次のゲームから参加できます。'}
        </div>
      `}

      <${PlayerStrip} snap=${snap} players=${players} emotes=${emotes} send=${send} />
      ${view.over && html`<${ResultCard} snap=${snap} players=${players} send=${send} />`}
      <${ui.Board} key=${game.no} view=${view} seat=${game.seat} players=${players} act=${act} />

      <div class="emote-bar">
        ${EMOTES.map((emoji) => html`<button key=${emoji} onClick=${() => send({ t: 'emote', emoji })} aria-label=${`リアクション ${emoji}`}>${emoji}</button>`)}
        ${watchers.length > 0 && html`<span class="muted">観戦 ${watchers.length}人</span>`}
      </div>

      ${showRules && html`<${RulesModal} gameId=${game.id} onClose=${() => setShowRules(false)} />`}
      ${showMenu &&
      html`
        <${Modal} title="ホストメニュー" onClose=${() => setShowMenu(false)}>
          <div class="stack">
            <button
              class="btn btn-block"
              onClick=${() => {
                send({ t: 'rematch' });
                setShowMenu(false);
              }}
            >
              🔄 このゲームを最初からやり直す
            </button>
            <button
              class="btn btn-block"
              onClick=${() => {
                send({ t: 'toLobby' });
                setShowMenu(false);
              }}
            >
              🚪 ゲームをやめてロビーにもどる
            </button>
            <p class="muted">席を外した人の番で止まったときは、その人の名前の下に出る「CPU に1手まかせる」で進められます。</p>
          </div>
        <//>
      `}
    </main>
  `;
}
