// コロコロガーデンの盤面。

import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { Avatar, Die, paletteOf } from '../ui.js';
import { play, useChanged } from '../sound.js';

const EVENT_MS = 3200;

function Board({ view, seat, players, act }) {
  const size = view.size;
  const [event, setEvent] = useState(null);
  const [rolling, setRolling] = useState(false);
  const seenEvent = useRef(view.event?.id ?? 0);
  const diceKey = view.dice ? `${view.temp.length}:${view.dice.join('-')}:${view.turn}` : '';

  // 「しっぱい」や「花が咲いた」を少しのあいだ大きく知らせる。
  useEffect(() => {
    const id = view.event?.id ?? 0;
    if (id === seenEvent.current) return undefined;
    seenEvent.current = id;
    setEvent(view.event);
    if (view.event.type === 'bust') {
      play('dice');
      play('fail', { delay: 0.4 });
    } else {
      play('chime');
    }
    const timer = setTimeout(() => setEvent(null), EVENT_MS);
    return () => clearTimeout(timer);
  }, [view.event?.id]);

  useEffect(() => {
    if (!diceKey) return undefined;
    setRolling(true);
    const timer = setTimeout(() => setRolling(false), 450);
    return () => clearTimeout(timer);
  }, [diceKey]);

  useChanged(diceKey, (key) => {
    if (key) play('dice');
  });
  useChanged(view.temp.length, (now, before) => {
    if (now > before) play('pop');
  });

  const active = view.turn;
  const myTurn = !view.over && active === seat;
  const colorOf = (s) => paletteOf(players[s]).color;
  const temp = new Set(view.temp);
  const options = new Set(view.options);
  const usedRows = new Set(view.temp.map((i) => Math.floor(i / size)));
  const usedCols = new Set(view.temp.map((i) => i % size));
  const bloomed = new Set(event?.type === 'bank' ? event.cells : []);
  const lost = new Set(event?.type === 'bust' ? event.lost : []);
  const riskPercent = view.risk === null ? null : Math.round(view.risk * 100);
  // いまやめたら花がいくつになるか。目標に届いていれば、やめた瞬間に勝ち。
  const wouldHave = active >= 0 ? view.flowers[active] + view.temp.length : 0;
  const canWin = !view.over && view.temp.length > 0 && wouldHave >= view.target;
  const firstTurn = !view.over && view.cap < view.size;
  const name = (s) => players[s]?.name ?? '?';

  let status;
  if (view.over) status = `花が ${view.target} 個そろいました！`;
  else if (view.phase === 'place') {
    status = myTurn ? '光っているマスをタップして、種をまきましょう' : `${name(active)} さんが種をまくマスを選んでいます`;
  } else if (myTurn) {
    status = view.temp.length === 0 ? 'あなたの番です。サイコロをふりましょう' : canWin ? 'やめれば花が ' + wouldHave + ' 個。あなたの勝ちです！' : 'もう1回ふる？ それともやめる？';
  } else status = `${name(active)} さんの番です`;

  return html`
    <div class="game korokoro">
      <div class="kk-wrap">
        <div class="kk-collabels" style=${`--n:${size}`}>
          ${Array.from({ length: size }, (_, c) => html`
            <span key=${c} class=${cx('kk-label', usedCols.has(c) && 'is-used')}><${Die} value=${c + 1} size="sm" /></span>
          `)}
        </div>
        <div class="kk-rowlabels" style=${`--n:${size}`}>
          ${Array.from({ length: size }, (_, r) => html`
            <span key=${r} class=${cx('kk-label', usedRows.has(r) && 'is-used')}><${Die} value=${r + 1} size="sm" /></span>
          `)}
        </div>
        <div class="board kk-board" style=${`--n:${size}`}>
          ${view.owner.map((owner, i) => {
            const r = Math.floor(i / size);
            const c = i % size;
            const isTemp = temp.has(i);
            const isOption = options.has(i);
            const blocked = !view.over && view.temp.length > 0 && !isTemp && (usedRows.has(r) || usedCols.has(c));
            return html`
              <button
                key=${i}
                class=${cx(
                  'cell soil',
                  isOption && 'is-option',
                  isOption && myTurn && 'is-open',
                  blocked && 'is-blocked',
                  bloomed.has(i) && 'is-bloom',
                  lost.has(i) && 'is-lost',
                )}
                disabled=${!(isOption && myTurn)}
                onClick=${() => act({ type: 'place', cell: i })}
                aria-label=${`${r + 1}行${c + 1}列`}
              >
                ${owner >= 0 && html`<span class="flower" style=${`--c:${colorOf(owner)}`}>✿</span>`}
                ${isTemp && html`<span class="seed" style=${`--c:${colorOf(active)}`}>🌱</span>`}
                ${isOption && html`<span class="option-tag">${owner >= 0 ? 'うばう' : 'ここ'}</span>`}
                ${lost.has(i) && html`<span class="lost-mark">💨</span>`}
              </button>
            `;
          })}
        </div>
      </div>

      <div class="panel">
        ${event &&
        html`
          <div class=${cx('kk-event', event.type === 'bust' ? 'is-bust' : 'is-bank')}>
            <${Avatar} player=${players[event.seat]} size="sm" />
            ${event.type === 'bust'
              ? html`<span>
                  <b>しっぱい！</b> ${' '}
                  <${Die} value=${event.dice[0]} size="xs" /> <${Die} value=${event.dice[1]} size="xs" />
                  ${' '}ではまけず、${event.lost.length > 0 ? `種を ${event.lost.length} つ失いました` : '何もまけませんでした'}
                </span>`
              : html`<span>
                  <b>花が ${event.cells.length} つ咲きました！</b>
                  ${event.stolen.length > 0 && `（うち ${event.stolen.length} つはうばった花）`}
                </span>`}
          </div>
        `}

        <p class=${cx('status', myTurn && 'is-mine')}>${status}</p>

        ${!view.over &&
        html`
          <div class="kk-turn">
            <div class="kk-dice">
              ${view.dice
                ? html`<${Die} value=${view.dice[0]} size="lg" rolling=${rolling} /><${Die} value=${view.dice[1]} size="lg" rolling=${rolling} />`
                : html`<span class="die-wait">🎲</span>`}
            </div>
            <div class="kk-turn-info">
              <span>この番にまいた種 <b>${view.temp.length}</b>${firstTurn ? ` / ${view.cap} つまで` : ''}</span>
              ${riskPercent !== null &&
              html`<span class=${cx('kk-risk', riskPercent >= 50 ? 'is-high' : riskPercent >= 25 ? 'is-mid' : 'is-low')}>
                次にふって失敗する確率 <b>${riskPercent}%</b>
              </span>`}
            </div>
          </div>
        `}

        ${myTurn &&
        view.phase === 'roll' &&
        html`
          <div class="row">
            <button class="btn btn-primary" onClick=${() => act({ type: 'roll' })}>
              🎲 ${view.temp.length === 0 ? 'サイコロをふる' : 'もう1回ふる'}
            </button>
            <button class="btn btn-safe" disabled=${view.temp.length === 0} onClick=${() => act({ type: 'bank' })}>
              🌷 ${canWin ? 'やめて勝つ！' : 'やめて花にする'}
            </button>
          </div>
        `}

        ${firstTurn &&
        html`<p class="kk-first">最初の番だけ、まける種は ${name(active)} さんが ${view.cap} つまで（先に動く人ほど少なくなります）</p>`}
        <p class="kk-legend">先に花を ${view.target} 個咲かせた人の勝ち</p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        サイコロをふって、花壇に種をまきます。ふればふるほど種は増えるけれど、失敗すると全部パー。やめどきが勝負のチキンレースです。
      </p>
      <h3>自分の番</h3>
      <ol>
        <li>
          サイコロを2個ふります。出た目が<b>「行」と「列」</b>になります。たとえば 3 と 5 なら「3行5列」か「5行3列」のどちらかに種をまきます。
        </li>
        <li><b>もう1回ふる</b>か、<b>やめる</b>かを決めます。やめると、この番にまいた種がすべて花になり、自分のものになります。</li>
      </ol>
      <h3>種をまけないマス</h3>
      <ul>
        <li>自分の花があるマス。</li>
        <li><b>この番にすでに種をまいた行と列</b>。まけばまくほど、使える場所が減っていきます。</li>
      </ul>
      <h3>しっぱい</h3>
      <p>出た目のどちらのマスにもまけなかったら失敗です。<b>この番にまいた種はすべて消えて</b>、番が終わります。</p>
      <h3>うばう</h3>
      <p>相手の花があるマスにも種をまけます。やめて花になったとき、そのマスは自分のものになります。</p>
      <h3>勝敗</h3>
      <ul>
        <li><b>先に花を 10 個</b>（5人で遊ぶときは 9 個）咲かせた人の勝ちです。</li>
        <li>やめて花にした瞬間に数えます。届いていれば、<b>その場でゲーム終了</b>です。</li>
        <li>うばわれると花は減ります。あと少しの人がいたら、その人の花をねらいましょう。</li>
      </ul>
      <h3>こまかいルール</h3>
      <ul>
        <li>
          <b>最初の番だけ</b>、まける種の数に上限があります。1番目の人は 1つ、2番目の人は 2つ、3番目の人は 3つ…まで。先に動く人が得をしすぎないためのハンデです。
        </li>
        <li>種を6つまくと（最初の番は上限まで まくと）、その場で自動的に花になります。</li>
      </ul>
      <h3>コツ</h3>
      <ul>
        <li>画面に出る「失敗する確率」が目安。種が3つを超えるとかなり危険です。</li>
        <li>だれかがあと2〜3個まで来たら、次の番で決められてしまうかも。強気にふるか、その人からうばうか。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.flowers,
  unit: '個',
  progress: (view) => `先に ${view.target} 個で勝ち`,
  waiting: () => false,
  extra: (view, s) => (view.flowers[s] >= view.target ? 'ゴール！' : `あと ${view.target - view.flowers[s]} 個`),
};
