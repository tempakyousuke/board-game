// ルームの待合室。メンバーを集めて、ホストがゲームを選んで始める。

import { html, useState, cx } from './lib.js';
import { Avatar, GameCard, Modal } from './ui.js';
import { GAME_UI, GAME_METAS } from './games/index.js';
import { RulesModal } from './game.js';
import { MAX_PLAYERS } from '/shared/palette.js';

function ShareBox({ code, notify }) {
  const url = `${location.origin}/r/${code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify('URL をコピーしました', 'info');
    } catch {
      notify('コピーできませんでした。URL を長押ししてコピーしてください');
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'ボドゲひろば', text: 'いっしょにボードゲームしよう！', url });
    } catch {
      /* 共有をやめただけ */
    }
  };
  return html`
    <section class="card share">
      <div class="share-code">
        <span>ルームコード</span>
        <b>${code}</b>
      </div>
      <div class="share-main">
        <p>この URL を友達に送ると、同じルームに入れます。</p>
        <div class="share-url">
          <input readonly value=${url} onFocus=${(e) => e.target.select()} aria-label="ルームの URL" />
          <button class="btn btn-primary btn-small" onClick=${copy}>コピー</button>
          ${typeof navigator.share === 'function' && html`<button class="btn btn-small" onClick=${share}>共有</button>`}
        </div>
      </div>
    </section>
  `;
}

export function Lobby({ snap, send, notify }) {
  const { room, you } = snap;
  const [rulesFor, setRulesFor] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const isHost = room.hostId === you;
  const me = room.players.find((p) => p.id === you);
  const host = room.players.find((p) => p.id === room.hostId);
  const active = room.players.filter((p) => !p.spectator);
  const watchers = room.players.filter((p) => p.spectator);
  const meta = GAME_UI[room.gameId].meta;
  const count = active.length;

  let hint = null;
  if (count < meta.minPlayers) hint = `あと ${meta.minPlayers - count} 人必要です（CPU を追加しても遊べます）`;
  else if (count > meta.maxPlayers) hint = `このゲームは ${meta.maxPlayers} 人まで。${count - meta.maxPlayers} 人が観戦にまわってください`;

  return html`
    <main class="page">
      <${ShareBox} code=${room.code} notify=${notify} />

      <section class="card">
        <div class="card-head">
          <h2>メンバー <small>${count} / ${MAX_PLAYERS}</small></h2>
          ${isHost &&
          html`<button class="btn btn-small" disabled=${count >= MAX_PLAYERS} onClick=${() => send({ t: 'addBot' })}>🤖 CPU を追加</button>`}
        </div>
        <ul class="members">
          ${active.map(
            (p) => html`
              <li key=${p.id} class=${cx('member', !p.connected && 'is-away')}>
                <${Avatar} player=${p} size="lg" />
                <span class="member-name">
                  ${p.name}
                  ${p.id === room.hostId && html`<span class="tag tag-host">ホスト</span>`}
                  ${p.id === you && html`<span class="tag">あなた</span>`}
                  ${p.bot && html`<span class="tag">CPU</span>`}
                  ${!p.connected && html`<span class="tag tag-away">切断中</span>`}
                </span>
                ${p.id === you && html`<button class="link-btn" onClick=${() => setRenaming(true)}>名前を変える</button>`}
                ${isHost &&
                p.id !== you &&
                html`<button class="icon-btn" onClick=${() => send({ t: 'kick', playerId: p.id })} aria-label=${`${p.name} を外す`}>✕</button>`}
              </li>
            `,
          )}
        </ul>
        ${watchers.length > 0 &&
        html`<p class="muted watchers">👀 観戦: ${watchers.map((p) => p.name + (p.id === you ? '（あなた）' : '')).join('、')}</p>`}
        <button class="link-btn" onClick=${() => send({ t: 'setSpectator', value: !me.spectator })}>
          ${me.spectator ? 'プレイヤーとして参加する' : '観戦にまわる'}
        </button>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>ゲームをえらぶ</h2>
          ${!isHost && html`<small class="muted">${host?.name ?? 'ホスト'} さんが選びます</small>`}
        </div>
        <div class="game-grid">
          ${GAME_METAS.map((m) => {
            let mismatch = null;
            if (count < m.minPlayers) mismatch = `あと ${m.minPlayers - count} 人いれば遊べます`;
            else if (count > m.maxPlayers) mismatch = `${m.maxPlayers} 人までのゲームです`;
            return html`
              <${GameCard}
                key=${m.id}
                meta=${m}
                compact
                mismatch=${mismatch}
                selected=${room.gameId === m.id}
                onSelect=${isHost ? () => send({ t: 'setGame', gameId: m.id }) : undefined}
                onRules=${() => setRulesFor(m.id)}
              />
            `;
          })}
        </div>
      </section>

      <div class="start-bar">
        ${hint && html`<p class="start-hint">${hint}</p>`}
        ${isHost
          ? html`<button class="btn btn-primary btn-big" disabled=${!!hint} onClick=${() => send({ t: 'start' })}>
              「${meta.name}」をはじめる
            </button>`
          : html`<p class="start-wait">${host?.name ?? 'ホスト'} さんがゲームを始めるのを待っています…</p>`}
      </div>

      ${rulesFor && html`<${RulesModal} gameId=${rulesFor} onClose=${() => setRulesFor(null)} />`}
      ${renaming &&
      html`
        <${Modal} title="名前を変える" onClose=${() => setRenaming(false)}>
          <${NameForm}
            initial=${me.name}
            label="変更する"
            onSubmit=${(name) => {
              send({ t: 'rename', name });
              setRenaming(false);
            }}
          />
        <//>
      `}
    </main>
  `;
}

export function NameForm({ initial = '', label, onSubmit, autoFocus = true }) {
  const [name, setName] = useState(initial);
  const submit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return html`
    <form class="name-form" onSubmit=${submit}>
      <input
        value=${name}
        onInput=${(e) => setName(e.target.value)}
        maxlength="12"
        placeholder="なまえ（12文字まで）"
        autofocus=${autoFocus}
        aria-label="なまえ"
        autocomplete="nickname"
      />
      <button class="btn btn-primary" disabled=${!name.trim()}>${label}</button>
    </form>
  `;
}
