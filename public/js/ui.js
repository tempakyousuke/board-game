// どの画面でも使う小さな部品。

import { html, useEffect, cx } from './lib.js';
import { PALETTE } from '/shared/palette.js';

const SPECTATOR = { name: '観戦', color: '#9a8c7a', soft: '#efe7d8', emoji: '👀' };

export function paletteOf(player) {
  return player && player.color >= 0 ? PALETTE[player.color] : SPECTATOR;
}

/** プレイヤーの丸いアイコン (色 + 動物)。 */
export function Avatar({ player, size = 'md', active = false }) {
  const pal = paletteOf(player);
  return html`
    <span
      class=${cx('avatar', `avatar-${size}`, active && 'is-active', player && !player.connected && 'is-away')}
      style=${`--c:${pal.color};--soft:${pal.soft}`}
      title=${player?.name}
    >
      <span class="avatar-face">${pal.emoji}</span>
      ${player?.bot && html`<span class="avatar-badge" aria-label="CPU">🤖</span>`}
    </span>
  `;
}

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`
    <div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${cx('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-label=${title}>
        <header class="modal-head">
          <h2>${title}</h2>
          <button class="icon-btn" onClick=${onClose} aria-label="とじる">✕</button>
        </header>
        <div class="modal-body">${children}</div>
      </div>
    </div>
  `;
}

export function Toasts({ items }) {
  return html`
    <div class="toasts" aria-live="polite">
      ${items.map((t) => html`<div key=${t.id} class=${cx('toast', t.kind === 'info' && 'toast-info')}>${t.text}</div>`)}
    </div>
  `;
}

const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** サイコロの目を点で描く。 */
export function Die({ value, size = 'md', rolling = false, tone = '' }) {
  const on = new Set(PIPS[value] ?? []);
  return html`
    <span class=${cx('die', `die-${size}`, rolling && 'is-rolling', tone && `die-${tone}`)} role="img" aria-label=${`サイコロの${value ?? '?'}`}>
      ${Array.from({ length: 9 }, (_, i) => html`<i key=${i} class=${on.has(i) ? 'pip on' : 'pip'}></i>`)}
    </span>
  `;
}

/** ゲームごとのカバー絵 (絵文字とテーマ色)。 */
export const GAME_ART = {
  toudai: { bg: 'linear-gradient(160deg,#1d4e6f,#0f2c44)', fg: '#fff', icons: ['🌊', '🔦'] },
  gottsunko: { bg: 'linear-gradient(160deg,#f4c95d,#e59a3c)', fg: '#4a2c0a', icons: ['💎', '💥'] },
  dokan: { bg: 'linear-gradient(160deg,#4a3f5c,#2a2236)', fg: '#fff', icons: ['💣', '🔥'] },
  korokoro: { bg: 'linear-gradient(160deg,#8fd16f,#4aa85a)', fg: '#123b1a', icons: ['🎲', '🌷'] },
  bento: { bg: 'linear-gradient(160deg,#f9b27c,#e8704a)', fg: '#4a1d0a', icons: ['🍱', '🍤'] },
  tataki: { bg: 'linear-gradient(160deg,#c94f4f,#8c2f39)', fg: '#fff', icons: ['🔔', '🏺'] },
  hitsuji: { bg: 'linear-gradient(160deg,#ffcf8a,#f29b6b)', fg: '#4a2c0a', icons: ['🐑', '🐕'] },
  ninja: { bg: 'linear-gradient(160deg,#3d4a6b,#1c2238)', fg: '#fff', icons: ['🥷', '👣'] },
  noronoro: { bg: 'linear-gradient(160deg,#bfe3a1,#7cc47a)', fg: '#123b1a', icons: ['🐌', '🏁'] },
  hatake: { bg: 'linear-gradient(160deg,#c98f5a,#8a5a33)', fg: '#fff', icons: ['🥕', '🌽'] },
  docchi: { bg: 'linear-gradient(160deg,#ffb3c7,#f0719b)', fg: '#4a1028', icons: ['🤝', '❓'] },
  obake: { bg: 'linear-gradient(160deg,#7a63a8,#3b2f4a)', fg: '#fff', icons: ['👻', '🃏'] },
  ohajiki: { bg: 'linear-gradient(160deg,#8ed0e8,#3f8fb5)', fg: '#06324a', icons: ['🎯', '💥'] },
};

/**
 * ゲーム1つぶんのカード。
 * compact: 一覧を短くしたいロビー用 (タグを出さない)。
 * mismatch: いまの人数では遊べないときに出す注意書き。
 */
export function GameCard({ meta, selected = false, onSelect, onRules, compact = false, mismatch = null }) {
  const art = GAME_ART[meta.id];
  const players =
    meta.minPlayers === meta.maxPlayers ? `${meta.minPlayers}人` : `${meta.minPlayers}〜${meta.maxPlayers}人`;
  const Tag = onSelect ? 'button' : 'div';
  return html`
    <div class=${cx('game-card', selected && 'is-selected', compact && 'is-compact', mismatch && 'is-mismatch')}>
      <${Tag} class="game-card-main" onClick=${onSelect} aria-pressed=${onSelect ? selected : undefined}>
        <span class="game-card-art" style=${`background:${art.bg};color:${art.fg}`}>
          <span>${art.icons[0]}</span><span>${art.icons[1]}</span>
        </span>
        <span class="game-card-text">
          <span class="game-card-name">${meta.name}</span>
          <span class="game-card-tagline">${meta.tagline}</span>
          <span class="game-card-meta">
            <span class=${cx('pill', mismatch && 'pill-warn')}>👥 ${players}</span>
            <span class="pill">⏱ ${meta.time}</span>
            ${!compact && meta.tags.map((tag) => html`<span key=${tag} class="pill pill-soft">${tag}</span>`)}
            ${compact && html`<span class="pill pill-soft">${meta.tags[0]}</span>`}
          </span>
          ${mismatch && html`<span class="game-card-mismatch">${mismatch}</span>`}
        </span>
        ${selected && html`<span class="game-card-check" aria-hidden="true">✓</span>`}
      <//>
      ${onRules && html`<button class="link-btn game-card-rules" onClick=${onRules}>${compact ? 'ルール' : 'ルールを見る'}</button>`}
    </div>
  `;
}

/** 順位つきの結果カード。 */
export function medal(place) {
  return ['🥇', '🥈', '🥉'][place - 1] ?? `${place}位`;
}
