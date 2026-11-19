// 「◯個！」と数を宣言する操作 (ロシアンたこパ・わさび係はだれだ・つみあげ注意・はったり骨董市で共通)。

import { html, useState, useEffect } from '../lib.js';

/**
 * min〜max の数をえらんで宣言する。onPass を渡すと「パス」も出す (passLabel でボタンの文を変えられる)。
 * label(amount) は宣言ボタンの文。
 */
export function BidBox({ min, max, label, onBid, onPass, passNote, passLabel = 'パス' }) {
  const [amount, setAmount] = useState(min);
  useEffect(() => setAmount(min), [min, max]);
  const value = Math.min(max, Math.max(min, amount));
  const possible = min <= max;
  return html`
    <div class="bb">
      ${possible &&
      html`
        <div class="bb-qty">
          <button class="bb-step" disabled=${value <= min} onClick=${() => setAmount(value - 1)} aria-label="1つへらす">−</button>
          <b class="bb-value">${value}</b>
          <button class="bb-step" disabled=${value >= max} onClick=${() => setAmount(value + 1)} aria-label="1つふやす">＋</button>
        </div>
      `}
      <div class="row">
        ${possible && html`<button class="btn btn-primary bb-bid" onClick=${() => onBid(value)}>📣 ${label(value)}</button>`}
        ${onPass && html`<button class="btn bb-pass" onClick=${onPass}>${passLabel}</button>`}
      </div>
      ${passNote && html`<p class="bb-note">${passNote}</p>`}
    </div>
  `;
}
