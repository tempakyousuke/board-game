// ビーだま工場の画面。

import { html, useState, useEffect, cx } from '../lib.js';
import { ANY, ROUNDS, TRAY, REVEAL_LEAD_MS, REVEAL_STEP_MS, flow, land, canPay, payment } from '/shared/games/bidama.js';
import { Avatar } from '../ui.js';
import { play, useChanged } from '../sound.js';
import { useReplay } from '../replay.js';

const COLOR_NAMES = ['赤', '青', '黄', '緑'];
// 色だけに頼らないよう、玉の中に形も入れる。
const GLYPHS = ['●', '◆', '▲', '■'];

function Ball({ color, size = 'md', faded = false }) {
  if (color === ANY) return html`<span class=${cx('bd-ball is-any', `bd-ball-${size}`)} role="img" aria-label="どの色でも">◎</span>`;
  return html`<span class=${cx('bd-ball', `c${color}`, `bd-ball-${size}`, faded && 'is-faded')} role="img" aria-label=${`${COLOR_NAMES[color]}の玉`}>${GLYPHS[color]}</span>`;
}

/** 機械のはたらきを、絵で1行に書く。 */
function Effect({ m, size = 'sm' }) {
  if (m.kind === 'none') return html`<span class="bd-effect is-none">かざり</span>`;
  return html`
    <span class="bd-effect">
      <${Ball} color=${m.in} size=${size} />
      <i class="bd-arrow">▶</i>
      ${m.kind === 'star' && html`<b class="bd-star">${'★'.repeat(m.gain)}</b>`}
      ${m.kind === 'paint' && html`<${Ball} color=${m.out} size=${size} />`}
      ${m.kind === 'bonus' && html`<b class="bd-plus">＋</b><${Ball} color=${m.out} size=${size} />${m.out2 !== undefined && html`<${Ball} color=${m.out2} size=${size} />`}`}
    </span>
  `;
}

const describe = (m) => {
  const from = m.in === ANY ? 'どの色の玉でも' : m.kind === 'none' ? '' : `${COLOR_NAMES[m.in]}の玉が通ると`;
  if (m.kind === 'star') return `${from}、★${m.gain}個`;
  if (m.kind === 'paint') return `${from}、${COLOR_NAMES[m.out]}に変わる`;
  if (m.kind === 'bonus') return `${from}、${COLOR_NAMES[m.out]}${m.out2 !== undefined ? `と${COLOR_NAMES[m.out2]}` : ''}の玉がうまれる`;
  return '何も起きない（点が高い）';
};

function Cost({ cost }) {
  return html`<span class="bd-cost">${cost.flatMap((count, c) => Array.from({ length: count }, (_, i) => html`<${Ball} key=${`${c}-${i}`} color=${c} size="xs" />`))}</span>`;
}

/** 皿。6個ぶんのくぼみに、色の順で玉をならべる。 */
function Tray({ tray, size = 'sm' }) {
  const balls = tray.flatMap((count, c) => new Array(count).fill(c));
  return html`
    <span class="bd-tray" aria-label=${`皿の玉 ${balls.length}個`}>
      ${Array.from({ length: TRAY }, (_, i) => (i < balls.length ? html`<${Ball} key=${i} color=${balls[i]} size=${size} />` : html`<i key=${i} class=${cx('bd-hole', `bd-ball-${size}`)}></i>`))}
    </span>
  `;
}

function Board({ view, seat, players, act }) {
  const { phase } = view;
  const playing = seat >= 0 && !view.over;
  const picking = phase === 'pick';
  const revealing = phase === 'reveal';
  const me = seat >= 0 ? view.players[seat] : null;
  const myResult = seat >= 0 && view.last ? view.last.results[seat] : null;
  const mySteps = revealing && myResult ? (myResult.kind === 'flow' ? myResult.steps : [{ build: true }]) : [];

  const shown = useReplay(revealing && seat >= 0, view.last?.id, mySteps.length, { lead: REVEAL_LEAD_MS, step: REVEAL_STEP_MS }, (i) => {
    const step = mySteps[i];
    if (step.build) play('up');
    else if (step.land) play('step');
    else if (step.stars) play('coin');
    else play('pop', { level: Math.min(1, i / 6) });
  });
  useChanged(phase, (now) => {
    if (now === 'reveal') play('card');
  });
  useChanged(view.myPick ? JSON.stringify(view.myPick) : '', (now) => {
    if (now) play('place');
  });

  // ---- えらんでいる手 (まだ出していない) ----
  const [sel, setSel] = useState(null);
  useEffect(() => setSel(null), [view.round]);
  const current = sel ?? view.myPick;
  const selCard = current?.kind === 'build' ? view[current.row][current.index] : null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const dirty = current !== null && !same(current, view.myPick);

  // ---- 自分の列の見え方 ----
  // 見せている最中: 動いたところまで。えらんでいる最中: さしこむ機械を仮に置く / 流したときに動く機械を光らせる。
  let line = me ? me.line.map((m) => ({ m })) : [];
  let tray = me ? me.tray.slice() : null;
  let stars = me ? me.stars : 0;
  let flying = null; // いま転がっている玉の色
  let previewText = null;
  if (me && revealing && myResult) {
    if (myResult.kind === 'flow') {
      flying = myResult.color;
      const done = myResult.steps.slice(0, shown ?? 0);
      for (const step of done) {
        if (step.land) land(tray, step.color);
        else {
          line[step.index].fired = true;
          stars += step.stars;
        }
      }
      const now = done[done.length - 1];
      if (now && !now.land) line[now.index].now = true;
      const next = myResult.steps[shown ?? 0];
      flying = next ? next.color : null;
    } else if ((shown ?? 0) >= 1) {
      line.splice(myResult.pos, 0, { m: myResult.card, fresh: true });
      tray = myResult.tray.slice();
    }
  } else if (me && picking && current) {
    if (current.kind === 'flow') {
      const r = flow(me.line, current.color);
      for (const step of r.steps) if (!step.land) line[step.index].will = true;
      const fired = r.steps.filter((s) => !s.land).length;
      previewText = html`<${Ball} color=${current.color} size="xs" /> を流すと、機械が <b>${fired}台</b> 動いて
        ${r.stars > 0 && html` <b class="bd-star">★${r.stars}</b>`} 玉が <b>${r.landed.length}個</b> 皿に落ちます`;
    } else if (selCard) {
      line.splice(current.pos, 0, { m: selCard, ghost: true });
      const paid = payment(me.tray, selCard.cost);
      previewText = paid ? html`代金: <${Cost} cost=${paid} />（${selCard.vp}点の機械）。さしこむ場所は、列の「＋」でえらべます` : null;
    }
  }

  const waitingFor = view.picked.filter((done) => !done).length;
  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (revealing) {
    if (!myResult) status = 'みんなの機械が動いています…';
    else if (myResult.kind === 'build') status = '機械をつくりました';
    else status = (shown ?? 0) >= mySteps.length ? `★${myResult.stars}・玉${myResult.landed.length}個` : '玉が流れています…';
  } else if (seat < 0) status = `あと ${waitingFor} 人が考えています`;
  else if (view.myPick && !dirty) status = waitingFor > 0 ? `えらびました。あと ${waitingFor} 人を待っています…` : '全員そろいました';
  else status = current ? 'これでよければ「決定」を押してください' : '玉を流す？ それとも機械をつくる？';

  const pickFlow = (color) => setSel({ kind: 'flow', color });
  const pickCard = (row, index) => setSel({ kind: 'build', row, index, pos: me.line.length });
  const movePos = (pos) => setSel({ ...current, pos });

  const shopCard = (m, row, index) => {
    const affordable = me ? canPay(me.tray, m.cost) : false;
    const on = current?.kind === 'build' && current.row === row && current.index === index;
    return html`
      <button
        key=${m.id}
        class=${cx('bd-card', m.big && 'is-big', on && 'is-on', playing && picking && !affordable && 'is-poor')}
        disabled=${!playing || !picking || !affordable}
        onClick=${() => pickCard(row, index)}
        aria-pressed=${on}
        aria-label=${`${describe(m)}。${m.vp}点`}
        title=${describe(m)}
      >
        <span class="bd-vp">${m.vp}点</span>
        <${Effect} m=${m} />
        <${Cost} cost=${m.cost} />
      </button>
    `;
  };

  /** 列の中の機械1台。 */
  const lineItem = (item, i) => html`
    <span
      key=${item.m.id + (item.ghost ? 'g' : '')}
      class=${cx('bd-machine', item.m.big && 'is-big', item.fired && 'is-fired', item.now && 'is-now', item.will && 'is-will', item.ghost && 'is-ghost', item.fresh && 'is-fresh')}
      title=${describe(item.m)}
    >
      <small>${i + 1}</small>
      <${Effect} m=${item.m} />
    </span>
  `;

  // さしこむ場所をえらぶ「＋」。仮に置いた機械の前後は出さない。
  const choosingPos = playing && picking && current?.kind === 'build' && selCard;
  const slots = [];
  if (me) {
    const real = me.line.length;
    let ri = 0; // もとの列での位置
    line.forEach((item, i) => {
      if (choosingPos && !item.ghost && ri !== current.pos) slots.push(html`<button key=${`slot${ri}`} class="bd-slot" onClick=${((pos) => () => movePos(pos))(ri)} aria-label=${`${ri + 1}番目にさしこむ`}>＋</button>`);
      slots.push(lineItem(item, i));
      if (!item.ghost) ri++;
    });
    if (choosingPos && current.pos !== real) slots.push(html`<button key="slotEnd" class="bd-slot" onClick=${() => movePos(real)} aria-label="右はしにさしこむ">＋</button>`);
  }

  const others = players.map((_, s) => s).filter((s) => s !== seat);
  const summary = (r) => {
    if (r.kind === 'build') return html`🔧 <${Effect} m=${r.card} size="xs" /> をつくった`;
    const fired = r.steps.filter((s) => !s.land).length;
    return html`<${Ball} color=${r.color} size="xs" /> を流して ${fired}台${r.stars > 0 ? html`・<b class="bd-star">★${r.stars}</b>` : ''}`;
  };

  return html`
    <div class="game bidama">
      <div class="bd-stage">
        <div class="bd-market">
          <div class="bd-market-head"><b>場の玉</b><span>1個えらんで流す（何人が同じ色をえらんでもOK）</span></div>
          <div class="bd-marbles">
            ${view.marbles.map(
              (color, i) => html`
                <button
                  key=${i}
                  class=${cx('bd-pick', current?.kind === 'flow' && current.color === color && 'is-on')}
                  disabled=${!playing || !picking}
                  onClick=${() => pickFlow(color)}
                  aria-label=${`${COLOR_NAMES[color]}の玉を流す`}
                >
                  <${Ball} color=${color} size="lg" />
                </button>
              `,
            )}
          </div>
          <div class="bd-market-head"><b>場の機械</b><span>皿の玉でつくる（足りない色は、ほかの玉2個で1個ぶん）</span></div>
          <div class="bd-shop">${view.small.map((m, i) => shopCard(m, 'small', i))}</div>
          <div class="bd-shop">${view.large.map((m, i) => shopCard(m, 'large', i))}</div>
        </div>

        ${me &&
        html`
          <div class="bd-mine">
            <div class="bd-mine-head">
              <b>あなたの工場</b>
              <span class="bd-star">★${stars}</span>
              <span>機械 ${me.vp}点</span>
              ${flying !== null && html`<span class="bd-flying"><${Ball} color=${flying} size="xs" /> が流れています</span>`}
            </div>
            <div class="bd-line">
              <span class="bd-in">入口 ▶</span>
              ${slots}
              <span class="bd-out">▶ 皿</span>
            </div>
            <div class="bd-traybox"><span>皿</span><${Tray} tray=${tray} size="md" /></div>
          </div>
        `}
      </div>

      <div class="panel">
        <p class=${cx('status', playing && picking && (!view.myPick || dirty) && 'is-mine')}>${status}</p>
        ${previewText && html`<p class="bd-preview">${previewText}</p>`}
        ${playing &&
        picking &&
        html`
          <button class="btn btn-primary btn-block" disabled=${!dirty} onClick=${() => act({ type: 'pick', ...current })}>
            ${!current ? '玉か機械をえらんでください' : !dirty ? 'えらびました' : current.kind === 'flow' ? `${COLOR_NAMES[current.color]}の玉を流す` : `この機械を ${current.pos + 1}番目につくる`}
          </button>
        `}

        <div class="bd-others">
          ${others.map((s) => {
            const p = view.players[s];
            const r = view.last && !picking ? view.last.results[s] : view.last && view.last.round === view.round - 1 ? view.last.results[s] : null;
            return html`
              <div key=${s} class="bd-other">
                <div class="bd-other-head">
                  <${Avatar} player=${players[s]} size="xs" />
                  <span class="bd-other-name">${players[s]?.name ?? '?'}</span>
                  <span class="bd-star">★${p.stars}</span>
                  <${Tray} tray=${p.tray} size="xs" />
                </div>
                <div class="bd-other-line">${p.line.map((m) => html`<span key=${m.id} class=${cx('bd-mini', m.big && 'is-big')} title=${describe(m)}><${Effect} m=${m} size="xs" /></span>`)}</div>
                ${r && html`<div class="bd-other-last">${summary(r)}</div>`}
              </div>
            `;
          })}
        </div>

        <p class="tb-legend">玉は左から右へ。色の合う機械が順に動きます（どの機械も1周に1回）。${ROUNDS}周で、機械の点 + ★ の多い人の勝ち。</p>
      </div>
    </div>
  `;
}

function Rules() {
  const sample = [
    { kind: 'paint', in: 1, out: 0 },
    { kind: 'star', in: 0, gain: 1 },
    { kind: 'bonus', in: 0, out: 2 },
    { kind: 'star', in: 2, gain: 1 },
  ];
  return html`
    <div class="rules bd-rules">
      <p class="rules-lead">
        玉を流すと、ならべた機械がつぎつぎ動きます。玉をためて機械をつくり、列にさしこんで、もっと長い連鎖に。どこにさしこむかで、動き方が変わります。全員が同時に進めるので、待ち時間はありません。
      </p>
      <h3>毎周やること</h3>
      <p>全員が同時に、次の<b>どちらか</b>をえらびます。場の玉と機械は全員共通で、同じものを何人がえらんでもかまいません。</p>
      <ul>
        <li><b>流す</b>：場の玉を1個えらび、自分の列の<b>左から</b>流します。右はしまで行った玉は、自分の<b>皿</b>にたまります。</li>
        <li><b>つくる</b>：皿の玉を払って場の機械をつくり、自分の列の<b>好きな場所</b>にさしこみます。</li>
      </ul>
      <h3>機械のはたらき</h3>
      <p>玉は左から右へ転がり、<b>色の合う機械</b>を順に動かします。</p>
      <ul class="bd-kinds">
        <li><${Effect} m=${sample[1]} /> 得点機：その色の玉が通ると ★ をもらいます。</li>
        <li><${Effect} m=${sample[0]} /> 変色機：玉の色が変わります。変わったあとの色で、右の機械を動かします。</li>
        <li><${Effect} m=${sample[2]} /> おまけ機：玉がもう1個うまれます。うまれた玉は、その機械の右から流れます。</li>
        <li><${Ball} color=${ANY} size="sm" /> の機械は、どの色の玉でも動きます。「かざり」は何も起きませんが、点が高い機械です。</li>
      </ul>
      <p>どの機械も、<b>1周に1回</b>だけ動きます。</p>
      <h3>例</h3>
      <p class="bd-example">${sample.map((m, i) => html`<span key=${i} class="bd-machine"><small>${i + 1}</small><${Effect} m=${m} /></span>`)}</p>
      <p>
        この列に<b>青い玉</b>を流すと、赤に変わる → ★ → 黄の玉がうまれる → 黄の玉で ★。4台が動いて ★2個、皿には赤と黄の玉が入ります。
      </p>
      <h3>皿と代金</h3>
      <ul>
        <li>皿に入る玉は <b>${TRAY}個</b>まで。いっぱいのときに玉が入ると、いちばん多い色の玉が1個おしだされます。</li>
        <li>機械の代金は、カードの下にならんだ玉です。<b>足りない色は、ほかの玉2個で1個ぶん</b>にできます。</li>
      </ul>
      <h3>場の入れかわり</h3>
      <ul>
        <li>玉は、毎周ぜんぶ入れかわります。</li>
        <li>だれかがつくった機械は場からなくなり、新しい機械が入ります。だれもつくらなかった段は、いちばん左の1枚が流れていきます。</li>
      </ul>
      <h3>終了</h3>
      <p><b>${ROUNDS}周</b>で終わり。<b>機械の点 + ★</b> の多い人の勝ちです。同点なら、★ の多い人が上です。</p>
      <h3>コツ</h3>
      <ul>
        <li>変色機やおまけ機は左に、得点機は右に置くと、連鎖がつながりやすくなります。</li>
        <li>玉をえらぶと、機械が何台動くかが先に見えます。いろいろ試してから決めましょう。</li>
        <li>何でもつくればよいわけではありません。つくる周は、玉を流せない周です。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.scores,
  unit: '点',
  progress: (view) => `${view.round} / ${view.maxRounds} 周`,
  waiting: (view) => !view.over && view.phase === 'pick',
  turnSound: false,
  turnSeats: (view, pending) => (view.phase === 'pick' ? pending : []),
  extra: (view, s) => `★${view.players[s].stars}・${view.players[s].line.length}台`,
};
