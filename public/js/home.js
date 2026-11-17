// トップページ。ルームを作るか、コードで参加する。

import { html, useState } from './lib.js';
import { GameCard } from './ui.js';
import { GAME_METAS } from './games/index.js';
import { RulesModal } from './game.js';

export function Home({ initialName, onCreate, onJoin, busy }) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const [rulesFor, setRulesFor] = useState(null);
  const ready = name.trim().length > 0;
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  return html`
    <main class="page page-home">
      <section class="hero">
        <p class="hero-kicker">インストールも登録もいりません</p>
        <h1>URL を送るだけ。<br />友達とボードゲーム。</h1>
        <p class="hero-lead">ここでしか遊べないオリジナルゲームを ${GAME_METAS.length} つ用意しました。1人でも6人でも、スマホでも遊べます。</p>

        <div class="card entry">
          <label class="field">
            <span>あなたの名前</span>
            <input
              value=${name}
              onInput=${(e) => setName(e.target.value)}
              maxlength="12"
              placeholder="なまえ（12文字まで）"
              autocomplete="nickname"
            />
          </label>
          <button class="btn btn-primary btn-big" disabled=${!ready || busy} onClick=${() => onCreate(name.trim())}>
            ${busy ? '準備中…' : '🎲 ルームを作る'}
          </button>
          <div class="entry-or"><span>または</span></div>
          <form
            class="entry-join"
            onSubmit=${(e) => {
              e.preventDefault();
              if (ready && cleanCode.length === 4) onJoin(cleanCode, name.trim());
            }}
          >
            <input
              class="code-input"
              value=${cleanCode}
              onInput=${(e) => setCode(e.target.value)}
              placeholder="コード"
              inputmode="text"
              autocapitalize="characters"
              autocomplete="off"
              aria-label="ルームコード（4文字）"
            />
            <button class="btn" disabled=${!ready || cleanCode.length !== 4 || busy}>コードで参加</button>
          </form>
        </div>
      </section>

      <section class="catalog">
        <h2>あそべるゲーム</h2>
        <div class="game-grid">
          ${GAME_METAS.map((m) => html`<${GameCard} key=${m.id} meta=${m} onRules=${() => setRulesFor(m.id)} />`)}
        </div>
      </section>

      <section class="howto">
        <h2>あそびかた</h2>
        <ol>
          <li><b>ルームを作る</b><span>名前を入れてボタンを押すだけ。</span></li>
          <li><b>URL を送る</b><span>LINE や Discord で友達に送ります。</span></li>
          <li><b>ゲームをえらぶ</b><span>人数が足りなければ CPU も呼べます。</span></li>
        </ol>
      </section>

      ${rulesFor && html`<${RulesModal} gameId=${rulesFor} onClose=${() => setRulesFor(null)} />`}
    </main>
  `;
}
