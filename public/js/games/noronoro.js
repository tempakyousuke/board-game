// のろのろレースの盤面。

import { html, useState, useEffect, cx } from '../lib.js';
import { RACERS, GOAL, LEAVES, PUDDLES, RANK_POINTS, HAND_SIZE, destination } from '/shared/games/noronoro.js';
import { Avatar } from '../ui.js';

const COLUMNS = GOAL + 1;

function cardLabel(card) {
  if (card.k === 'go') return { top: RACERS[card.racer].emoji, main: `+${card.v}`, sub: RACERS[card.racer].name, tone: 'go' };
  if (card.k === 'any') return { top: '✨', main: `+${card.v}`, sub: 'だれでも', tone: 'any' };
  return { top: '↩️', main: `−${card.v}`, sub: 'あともどり', tone: 'back' };
}

function Board({ view, seat, players, act }) {
  const [picked, setPicked] = useState(null);
  const [aim, setAim] = useState(null);
  const myTurn = !view.over && view.turn === seat;

  useEffect(() => {
    setPicked(null);
    setAim(null);
  }, [view.last?.id, view.turn]);

  const card = myTurn && picked !== null ? view.hand[picked] : null;
  const needsAim = card && card.k !== 'go';
  const racer = card ? (card.k === 'go' ? card.racer : aim) : null;
  const steps = card ? (card.k === 'back' ? -card.v : card.v) : 0;
  const preview = card && racer !== null ? destination(view.pos, racer, steps) : null;
  const rankOf = (r) => view.order.indexOf(r);
  const last = view.last;
  const name = (s) => players[s]?.name ?? '?';

  const play = () => {
    if (!card || racer === null) return;
    act(card.k === 'go' ? { type: 'play', card: picked } : { type: 'play', card: picked, racer });
  };

  let status;
  if (view.over) status = `${RACERS[view.order[0]].emoji} ${RACERS[view.order[0]].name} がゴール！`;
  else if (!myTurn) status = `${name(view.turn)} さんの番です`;
  else if (!card) status = 'あなたの番です。出すカードを選んでください';
  else if (racer === null) status = card.k === 'any' ? 'だれを進めますか？ レーンをタップ' : 'だれを下がらせますか？ レーンをタップ';
  else status = 'これでよければ「出す」を押してください';

  let confirmLabel = 'カードを選んでください';
  if (card && racer === null) confirmLabel = 'レーンを選んでください';
  else if (card) {
    const who = `${RACERS[racer].emoji} ${RACERS[racer].name}`;
    confirmLabel = steps > 0 ? `${who} を ${steps} マス進める` : `${who} を ${-steps} マスもどす`;
  }

  // ゴールしたあと、だれがどれを推していたかを見せる。
  const fans = (r) => (view.favs ? view.favs.map((f, s) => (f === r ? s : -1)).filter((s) => s >= 0) : []);
  const left = (pos) => `${((pos + 0.5) * 100) / COLUMNS}%`;

  return html`
    <div class="game noronoro">
      <div class="nr-track" style=${`--cols:${COLUMNS}`}>
        <div class="nr-head">
          <span class="nr-label"></span>
          <div class="nr-cells">
            ${Array.from({ length: COLUMNS }, (_, i) => html`
              <span key=${i} class=${cx('nr-mark', LEAVES.includes(i) && 'is-leaf', PUDDLES.includes(i) && 'is-puddle', i === GOAL && 'is-goal')}>
                ${LEAVES.includes(i) ? '🍃' : PUDDLES.includes(i) ? '💧' : i === GOAL ? '🏁' : i === 0 ? '' : i}
              </span>
            `)}
          </div>
        </div>
        ${RACERS.map((r, index) => {
          const mine = view.myFav === index;
          const canAim = needsAim;
          const moved = last && last.racer === index;
          const ghost = preview && racer === index ? preview.to : null;
          return html`
            <button
              key=${index}
              class=${cx('nr-lane', mine && 'is-fav', canAim && 'is-open', aim === index && needsAim && 'is-aim', moved && 'is-moved')}
              disabled=${!canAim}
              onClick=${() => setAim(index)}
              aria-label=${`${r.name} ${rankOf(index) + 1}位 ${view.pos[index]}マス目`}
            >
              <span class="nr-label">
                <i class="nr-rank">${rankOf(index) + 1}</i>
                ${mine && !view.favs && html`<i class="nr-star" title="あなたの推し">★</i>`}
                ${fans(index).map((s) => html`<${Avatar} key=${s} player=${players[s]} size="xs" />`)}
              </span>
              <div class="nr-cells">
                ${Array.from({ length: COLUMNS }, (_, i) => html`
                  <span key=${i} class=${cx('nr-cell', LEAVES.includes(i) && 'is-leaf', PUDDLES.includes(i) && 'is-puddle', i === GOAL && 'is-goal')}></span>
                `)}
                ${ghost !== null && html`<span class="nr-ghost" style=${`left:${left(ghost)}`}>${r.emoji}</span>`}
                <span class="nr-racer" style=${`left:${left(view.pos[index])}`}>${r.emoji}</span>
              </div>
            </button>
          `;
        })}
      </div>

      <div class="panel">
        ${last &&
        html`
          <p class="nr-last">
            <${Avatar} player=${players[last.seat]} size="xs" />
            ${RACERS[last.racer].emoji} ${RACERS[last.racer].name} を
            <b>${last.card.k === 'back' ? `${last.card.v} マスもどした` : `${last.card.v} マス進めた`}</b>
            ${last.effect === 'leaf' && html`<span class="nr-effect is-leaf">🍃 はっぱでもう1マス！</span>`}
            ${last.effect === 'puddle' && html`<span class="nr-effect is-puddle">💧 みずたまりで1マスもどる</span>`}
          </p>
        `}

        <p class=${cx('status', myTurn && 'is-mine')}>${status}</p>

        ${seat >= 0 &&
        !view.over &&
        html`
          <div class="nr-hand">
            ${view.hand.map((c, i) => {
              const label = cardLabel(c);
              return html`
                <button
                  key=${`${view.last?.id ?? 0}-${i}`}
                  class=${cx('nr-card', `is-${label.tone}`, picked === i && myTurn && 'is-on')}
                  disabled=${!myTurn}
                  onClick=${() => {
                    setPicked(i);
                    setAim(null);
                  }}
                >
                  <span class="nr-card-top">${label.top}</span>
                  <b>${label.main}</b>
                  <small>${label.sub}</small>
                </button>
              `;
            })}
          </div>
          ${myTurn && html`<button class="btn btn-primary btn-block" disabled=${!card || racer === null} onClick=${play}>${confirmLabel}</button>`}
        `}

        ${view.myFav !== null &&
        html`
          <p class="nr-fav">
            あなたの推し（ひみつ）：<b>${RACERS[view.myFav].emoji} ${RACERS[view.myFav].name}</b>
            <span>いま ${rankOf(view.myFav) + 1} 位 → ${RANK_POINTS[rankOf(view.myFav)]} 点</span>
          </p>
        `}
        <p class="muted nr-note">
          順位ごとの点: ${RANK_POINTS.map((p, i) => `${i + 1}位 ${p}`).join('・')}。🍃 にぴったり止まると +1、💧 は −1。
        </p>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">
        6匹ののんびり屋がゴールをめざします。あなたはその中の1匹をこっそり応援中。みんなでカードを出し合ってレースを進めますが、だれがどれを応援しているかは秘密です。
      </p>
      <h3>準備</h3>
      <ul>
        <li>各プレイヤーに、<b>「推し」</b>が1匹ずつこっそり決まります（ほかの人とはかぶりません）。</li>
        <li>手札は ${HAND_SIZE} 枚。</li>
      </ul>
      <h3>自分の番</h3>
      <p>手札から <b>1枚出して</b>、山札から1枚引きます。カードは3種類あります。</p>
      <ul>
        <li><b>「🐢 +2」のようなカード</b>：書かれた相手を、その数だけ進めます。出したら必ずそのとおりに進みます。</li>
        <li><b>✨ だれでも +2</b>：好きな1匹を2マス進めます。</li>
        <li><b>↩️ あともどり −2</b>：好きな1匹を2マスもどします。</li>
      </ul>
      <p>手札によっては、推しではない相手を進めるしかないこともあります。</p>
      <h3>コースのしかけ</h3>
      <ul>
        <li><b>🍃 はっぱ</b>のマスにぴったり止まると、もう1マス進みます。</li>
        <li><b>💧 みずたまり</b>のマスにぴったり止まると、1マスもどります。</li>
      </ul>
      <h3>終了と得点</h3>
      <ul>
        <li>だれか1匹がゴールしたら、その場でレース終了です。</li>
        <li>自分の推しの順位で点が入ります：${RANK_POINTS.map((p, i) => `${i + 1}位 ${p}点`).join('、')}。</li>
        <li>同じマスに並んでいるときは、先に着いていたほうが上の順位です。</li>
      </ul>
      <h3>コツ</h3>
      <ul>
        <li>推しばかり進めると、すぐにばれて「あともどり」でねらわれます。ときどき関係ない相手も進めて、ごまかしましょう。</li>
        <li>だれが「だれでも」カードでどれを進めたか、「あともどり」でどれを下げたかは、大きなヒントです。</li>
        <li>ゴールさせるのは自分でなくてもかまいません。2位や3位でも点は入ります。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => (view.over ? view.result.scores : null),
  unit: '点',
  progress: () => null,
  waiting: () => false,
  extra: (view, s) => (view.favs ? `推し ${RACERS[view.favs[s]].emoji}` : '推しはひみつ'),
};
