// 神器の箱庭の画面。

import { html, useState, useEffect, cx } from '../lib.js';
import {
  ARTIFACTS,
  TERRAINS,
  CHAOS,
  METEORS,
  METEOR_POWER,
  SIZE,
  START_HP,
  START_HAND,
  HAND_LIMIT,
  MAKAI_TURN,
  SPRING_HEAL,
  FOREST_COVER,
  MOUNTAIN_EDGE,
  WALL_HP,
  ORACLE_WAIT,
  MAX_HP,
  movesFor,
  neighborsOf,
  strikesNeighbor,
  optionsFor,
  powerOf,
  accuracyOf,
  accuracyDrop,
  damageOf,
} from '/shared/games/hakoniwa.js';
import { Avatar, paletteOf } from '../ui.js';
import { play, useChanged } from '../sound.js';

const KIND_NAMES = { weapon: '武器', guard: '防具', heal: '回復', miracle: '奇跡' };
const MIRACLE_TEXT = {
  erupt: 'どこか1マスを溶岩に。そこにいる人に3ダメージ',
  wall: `だれもいない1マスを岩かべに（耐久力 ${WALL_HP}）`,
  flatten: 'どこか1マスを平地にもどす',
  swap: 'だれか1人と、場所を入れかわる',
  dash: '2マス先までの空いたマスへ飛ぶ',
  chaos: `何が起きるかわからない（${Object.keys(CHAOS).length}つのうち、どれか1つ）`,
};

/** 神器のひとこと説明。 */
export function describe(id) {
  const art = ARTIFACTS[id];
  if (art.kind === 'guard') return `受けるダメージ −${art.block}`;
  if (art.kind === 'heal') return `HP +${art.amount}`;
  if (art.kind === 'miracle') return MIRACLE_TEXT[art.effect];
  const pierce = art.pierce ? '・貫通' : '';
  const shape = {
    line: art.range === 1 ? 'たて・よこのとなり' : `たて・よこ ${art.range}マス${pierce}`,
    diag: `ななめ ${art.range}マス${pierce}`,
    around: 'まわり8マスぜんぶ',
    cross: 'たて・よこ4方向ぜんぶ・貫通',
    star: '8方向ぜんぶ・貫通',
    bolt: 'どこにいても1人',
    all: 'どこにいても、ほかの全員',
  }[art.shape];
  return `威力${art.power}・${shape}${art.push ? `・${art.push}マス押す` : ''}`;
}

function Card({ id, on, dim, onClick, tag }) {
  const art = ARTIFACTS[id];
  return html`
    <button class=${cx('hn-card', `is-${art.kind}`, on && 'is-on', dim && 'is-dim')} disabled=${!onClick} onClick=${onClick} aria-pressed=${on}>
      <span class="hn-card-icon">${art.emoji}</span>
      <span class="hn-card-text"><b>${art.name}</b><small>${describe(id)}</small></span>
      <span class="hn-card-kind">${tag ?? KIND_NAMES[art.kind]}</span>
    </button>
  `;
}

function Board({ view, seat, players, act }) {
  const { phase } = view;
  const me = seat >= 0 && view.alive[seat] && !view.over;
  const name = (s) => (s === seat ? 'あなた' : `${players[s]?.name ?? '?'} さん`);
  const myTurn = me && view.turn === seat && (phase === 'move' || phase === 'use' || phase === 'pick');
  const attack = view.attack;
  const mustGuard = me && phase === 'guard' && attack.targets.includes(seat) && !attack.answered.includes(seat);
  const hand = view.myHand;

  // えらんでいる神器と使い方。番や手札が変わったら、えらび直す。
  const [sel, setSel] = useState({ card: null, pick: null });
  const [guards, setGuards] = useState([]);
  useEffect(() => {
    setSel({ card: null, pick: null });
    setGuards([]);
  }, [view.turnNo, phase, hand.length]);

  const last = view.events[view.events.length - 1];
  useChanged(view.events.length ? last.seq : 0, () => {
    if (!last) return;
    if (last.t === 'attack') play(last.results.some((r) => r.damage > 0) ? 'boom' : last.results.length ? 'bonk' : 'whoosh');
    else if (last.t === 'miss') play('whoosh');
    else if (last.t === 'heal') play('chime');
    else if (last.t === 'dead') play('lose');
    else if (last.t === 'makai' || last.t === 'chaos') play('smoke');
    else if (last.t === 'miracle') play('whoosh');
    else if (last.t === 'hurt') play('fail');
    else if (last.t === 'draw') play('card');
    else if (last.t === 'wall') play(last.broken ? 'boom' : 'bonk');
    else if (last.t === 'move') play('step');
  });
  useChanged(myTurn || mustGuard, (mine) => {
    if (mine) play('turn');
  });

  const moves = myTurn && phase === 'move' ? movesFor(view, seat) : [];
  const stuck = moves.length === 1 && moves[0] === view.pos[seat];
  // 移動の場面では、移動のかわりに、となりの人に当たる武器だけ使える。
  const striking = myTurn && phase === 'move';
  const canStrike = striking && neighborsOf(view, seat).length > 0;
  const using = myTurn && (phase === 'use' || canStrike);
  const allowed = (id, option) => !striking || strikesNeighbor(view, seat, id, option);
  const usableCard = (id) => ARTIFACTS[id].kind !== 'guard' && (!striking || optionsFor(view, seat, id).some((o) => allowed(id, o)));
  const options = using && sel.card !== null ? optionsFor(view, seat, hand[sel.card]) : [];
  const picked = sel.pick !== null ? options[sel.pick] : null;
  const selArt = sel.card !== null ? ARTIFACTS[hand[sel.card]] : null;
  // 使い方が1つしかない神器は、えらんだ時点で決まり。
  const pickCard = (card) => {
    if (sel.card === card) return setSel({ card: null, pick: null });
    const list = optionsFor(view, seat, hand[card]);
    const ok = list.map((o, i) => (allowed(hand[card], o) ? i : -1)).filter((i) => i >= 0);
    setSel({ card, pick: ok.length === 1 ? ok[0] : null });
  };
  const open = sel.card !== null ? options.filter((o) => allowed(hand[sel.card], o)) : [];

  const softCells = new Set(picked ? [] : open.flatMap((o) => o.cells));
  const hardCells = new Set(picked ? picked.cells : []);
  // 直前の攻撃 (いま受けている攻撃) の通り道。
  const shown = attack ?? (last && (last.t === 'attack' || last.t === 'miss' || last.cells) ? last : null);
  const shotCells = new Set(shown ? shown.cells : []);

  const tapCell = (cell) => {
    if (using && sel.card !== null) {
      const pick = options.findIndex((o) => allowed(hand[sel.card], o) && o.cells.includes(cell));
      if (pick >= 0) return setSel({ card: sel.card, pick });
    }
    if (moves.includes(cell)) act({ type: 'move', to: cell });
  };

  let status;
  if (view.over) status = 'おつかれさまでした！';
  else if (phase === 'guard') {
    const waiting = attack.targets.filter((t) => !attack.answered.includes(t));
    status = mustGuard ? `${name(attack.from)}の「${ARTIFACTS[attack.card].name}」が飛んできた！ 防具で受ける？` : `${waiting.map(name).join('・')}が、どう受けるか決めています`;
  } else if (!myTurn) status = `${name(view.turn)}の番です（${phase === 'use' ? '神器' : '移動'}）`;
  else if (phase === 'pick') status = `手札がいっぱい。「${ARTIFACTS[view.found].name}」をひろうなら、すてる神器をタップ`;
  else if (phase === 'move' && sel.card === null) status = stuck ? '動けるマスがありません。いまのマスをタップして、とどまる' : canStrike ? '光っているマスへ移動。または、移動のかわりに、となりの人を武器で攻撃' : '光っているマスをタップして移動';
  else if (sel.card === null) status = '神器を1枚えらんで使う（使わなくてもよい）';
  else if (!picked) status = options.length ? '盤の光っているマスをタップして、ねらいを決める' : 'いまは使えるところがありません';
  else status = picked.hits.length || selArt.kind !== 'weapon' ? '「使う」を押すと決定' : 'その向きには、だれもいません';

  // 自分が受ける攻撃の見込み。
  const guardBlock = guards.reduce((sum, i) => sum + ARTIFACTS[hand[i]].block, 0);
  const incoming = mustGuard ? damageOf(view, seat, attack.power, guardBlock) : 0;

  const line = (e) => {
    if (e.t === 'move') return e.stay ? `${name(e.seat)}は動けず、${TERRAINS[e.terrain].name}にとどまった` : `${name(e.seat)}が ${TERRAINS[e.terrain].name}へ移動`;
    if (e.t === 'draw') return `${name(e.seat)}が ${TERRAINS[e.terrain].name}の神器をひろった${e.dropped ? `（「${ARTIFACTS[e.dropped].name}」をすてた）` : ''}`;
    if (e.t === 'chaos') return `🎁 ${name(e.seat)}が「ふしぎな箱」を開けた → ${CHAOS[e.effect]}${e.effect === 'meteor' ? (e.hits.length ? `。${e.hits.map(name).join('・')}に ${METEOR_POWER}ダメージ` : '。だれにも当たらなかった') : ''}`;
    if (e.t === 'curseEnd') return `😈 魔界が消えて、地形が元にもどった`;
    if (e.t === 'oracleGone') return `🔮 予言の地が消えた（${ORACLE_WAIT}ターン後に、どこかに現れる）`;
    if (e.t === 'oracle') return `🔮 予言の地が現れた`;
    if (e.t === 'left') return `${name(e.seat)}は、神器をひろわなかった`;
    if (e.t === 'strike') return `${name(e.seat)}は動かずに、となりを攻撃`;
    if (e.t === 'wall') return e.broken ? `🧱 岩かべがこわれた` : `🧱 岩かべに ${e.amount}ダメージ`;
    if (e.t === 'hurt') return `${name(e.seat)}に ${e.amount}ダメージ（${TERRAINS[e.why]?.name ?? ARTIFACTS[e.why]?.name}）`;
    if (e.t === 'heal') return `${name(e.seat)}が HP+${e.amount}（${e.why === 'spring' ? '泉' : ARTIFACTS[e.why].name}）`;
    if (e.t === 'miss') return `${name(e.seat)}の「${ARTIFACTS[e.card].name}」は空ぶり`;
    if (e.t === 'dead') return `💀 ${name(e.seat)}が脱落`;
    if (e.t === 'makai') return `😈 ${MAKAI_TURN}ターンをすぎた。全部のマスが魔界になった！`;
    if (e.t === 'pushed') return `${name(e.seat)}が吹きとばされた`;
    if (e.t === 'miracle') return `${name(e.seat)}が「${ARTIFACTS[e.card].name}」を使った${e.target !== undefined ? `（${name(e.target)}と）` : ''}`;
    if (e.t === 'attack') {
      const parts = e.results.map((r) => `${name(r.seat)}に ${r.damage}ダメージ${r.guard.length ? `（${r.guard.map((id) => ARTIFACTS[id].name).join('・')}で受けた）` : ''}`);
      for (const s of e.missed ?? []) parts.push(`${name(s)}には外れた`);
      return `${name(e.seat)}の「${ARTIFACTS[e.card].name}」威力${e.power} → ${parts.join('、')}`;
    }
    return '';
  };

  const myCell = seat >= 0 && view.alive[seat] ? view.pos[seat] : -1;
  const turnsLeft = MAKAI_TURN - view.turnNo;

  return html`
    <div class="game hakoniwa">
      <div class=${cx('hn-stage', (view.makai || view.curseLeft > 0) && 'is-makai')}>
        <div class="tp-head">
          <b>${view.makai ? '😈 魔界' : view.curseLeft ? `😈 あと ${view.curseLeft}ターン魔界` : `ターン ${view.turnNo}`}</b>
          <span>${view.makai || view.curseLeft ? `どのマスにいても、毎ターン ${TERRAINS.makai.hurt}ダメージ` : turnsLeft <= 20 ? `あと ${turnsLeft + 1}ターンで、全部のマスが魔界になる` : `${MAKAI_TURN}ターンをすぎると、全部のマスが魔界になる`}</span>
        </div>
        <div class="hn-board" style=${`--size:${SIZE}`}>
          ${view.cells.map((terrain, cell) => {
            const who = view.pos.findIndex((p, s) => view.alive[s] && p === cell);
            const can = moves.includes(cell) || softCells.has(cell) || hardCells.has(cell);
            const wallHp = terrain === 'wall' ? (view.walls[cell] ?? WALL_HP) : 0;
            return html`
              <button
                key=${cell}
                class=${cx('hn-cell', `is-${terrain}`, moves.includes(cell) && 'is-move', softCells.has(cell) && 'is-soft', hardCells.has(cell) && 'is-hard', shotCells.has(cell) && 'is-shot', cell === myCell && 'is-mine')}
                disabled=${!can}
                onClick=${() => tapCell(cell)}
                aria-label=${`${TERRAINS[terrain].name}${who >= 0 ? `・${players[who]?.name}` : ''}`}
              >
                <span class="hn-terrain">${TERRAINS[terrain].emoji}</span>
                ${wallHp > 0 && html`<span class="hn-wall-hp" aria-label=${`耐久力 ${wallHp}`}>${wallHp}</span>`}
                ${who >= 0 &&
                html`
                  <span class=${cx('hn-piece', who === view.turn && !view.over && 'is-turn', attack?.targets.includes(who) && 'is-target')} style=${`--c:${paletteOf(players[who]).color}`}>
                    <${Avatar} player=${players[who]} size="sm" />
                    <b>${view.hp[who]}</b>
                  </span>
                `}
              </button>
            `;
          })}
        </div>
        ${view.oracleIn !== null && html`<p class="hn-here">🔮 予言の地は、あと ${view.oracleIn}ターンで、どこかに現れます</p>`}
        ${myCell >= 0 && html`<p class="hn-here">あなたは ${TERRAINS[view.cells[myCell]].emoji} ${TERRAINS[view.cells[myCell]].name}にいます・HP ${view.hp[seat]}・手札 ${hand.length} / ${HAND_LIMIT}</p>`}
      </div>

      <div class="panel">
        <p class=${cx('status', (myTurn || mustGuard) && 'is-mine')}>${status}</p>

        ${mustGuard &&
        html`
          <div class="hn-guard">
            <p class="hn-incoming">
              威力 <b>${attack.power}</b>${view.cells[myCell] === 'forest' ? `（森で −${FOREST_COVER}）` : ''} − 防具 <b>${guardBlock}</b> ＝ <b class=${incoming > 0 ? 'is-minus' : 'is-plus'}>${incoming}ダメージ</b>
            </p>
            <button class="btn btn-primary btn-block" onClick=${() => act({ type: 'guard', cards: guards })}>
              ${guards.length ? `防具 ${guards.length}枚で受ける（${guards.length}枚引き直す）` : 'そのまま受ける'}
            </button>
          </div>
        `}

        ${myTurn &&
        phase === 'pick' &&
        html`
          <div class="hn-found">
            <span>ひろえる神器</span>
            <${Card} id=${view.found} />
            <button class="btn btn-block" onClick=${() => act({ type: 'leave' })}>ひろわない</button>
          </div>
        `}

        ${using &&
        html`
          <div class="row">
            <button class="btn btn-primary" disabled=${!picked} onClick=${() => act({ type: 'use', card: sel.card, pick: sel.pick })}>
              ${picked
                ? `${striking ? '移動のかわりに' : ''}「${selArt.name}」を使う${selArt.kind === 'weapon' ? `（${picked.hits.length ? `${picked.hits.map((t) => `${name(t)}に命中${Math.round(accuracyOf(view, seat, hand[sel.card], t) * 100)}%`).join('・')}・威力${powerOf(view, seat, hand[sel.card])}` : picked.walls.length ? `岩かべに威力${powerOf(view, seat, hand[sel.card])}` : '空ぶり'}）` : ''}`
                : striking
                  ? '移動のかわりに攻撃（武器をえらぶ）'
                  : '神器を使う'}
            </button>
            ${!striking && html`<button class="btn" onClick=${() => act({ type: 'skip' })}>使わない</button>`}
          </div>
          ${sel.card !== null &&
          options.length > 1 &&
          options[0].label &&
          html`
            <div class="hn-dirs">
              ${options.map(
                (o, i) => html`<button key=${i} class=${cx('hn-dir', sel.pick === i && 'is-on')} disabled=${!allowed(hand[sel.card], o)} onClick=${() => setSel({ card: sel.card, pick: i })}>${o.label}${o.hits.length ? ' ●' : o.walls.length ? ' 🧱' : ''}</button>`,
              )}
            </div>
          `}
        `}

        ${seat >= 0 &&
        hand.length > 0 &&
        html`
          <div class="hn-hand">
            ${hand.map((id, i) => {
              const art = ARTIFACTS[id];
              if (mustGuard) {
                const on = guards.includes(i);
                return html`<${Card} key=${i} id=${id} on=${on} dim=${art.kind !== 'guard'} onClick=${art.kind === 'guard' ? () => setGuards(on ? guards.filter((g) => g !== i) : [...guards, i]) : null} />`;
              }
              if (myTurn && phase === 'pick') return html`<${Card} key=${i} id=${id} onClick=${() => act({ type: 'swap', discard: i })} tag="すてる" />`;
              const usable = using && usableCard(id);
              return html`<${Card} key=${i} id=${id} on=${sel.card === i} dim=${using && !usable} onClick=${usable ? () => pickCard(i) : null} />`;
            })}
          </div>
        `}
        ${seat >= 0 && !view.alive[seat] && !view.over && html`<p class="hn-dead">あなたは脱落しました。決着まで見守りましょう。</p>`}

        <ol class="hn-log">
          ${view.events
            .slice(-7)
            .reverse()
            .map((e, i) => html`<li key=${e.seq} class=${cx(i === 0 && 'is-new', `is-${e.t}`)}>${line(e)}</li>`)}
        </ol>

        <details class="hn-legend">
          <summary>地形の早見</summary>
          <ul>
            ${Object.entries(TERRAINS).map(
              ([id, terrain]) => html`
                <li key=${id}>
                  <b>${terrain.emoji} ${terrain.name}</b>
                  <span>
                    ${{
                      plain: '効果なし',
                      forest: `受けるダメージ −${FOREST_COVER}`,
                      mountain: `自分の攻撃の威力 +${MOUNTAIN_EDGE}`,
                      spring: `番の初めに HP+${SPRING_HEAL}`,
                      ruin: '効果なし（奇跡がひろえる）',
                      lava: `移動のあと、ここにいると ${terrain.hurt}ダメージ`,
                      makai: `移動のあと、ここにいると ${terrain.hurt}ダメージ`,
                      oracle: `入ると特別な神器。入られると消えて、${ORACLE_WAIT}ターン後に別のマスに現れる`,
                      wall: `通れない。攻撃を受け止める（耐久力 ${WALL_HP}。0 になるとこわれて平地に）`,
                    }[id]}
                    ${Object.keys(terrain.deck).length > 0 && `／ ${Object.keys(terrain.deck).map((a) => ARTIFACTS[a].name).join('・')}`}
                  </span>
                </li>
              `,
            )}
          </ul>
        </details>
      </div>
    </div>
  `;
}

function Rules() {
  return html`
    <div class="rules">
      <p class="rules-lead">5×5 の箱庭を歩いて神器をひろい、ぶつけ合います。武器には形があり、地形でひろえる神器が変わります。最後の1人になれば勝ち。</p>
      <h3>3行でわかる</h3>
      <ul>
        <li>自分の番は、<b>移動 → 神器を1枚ひろう → 神器を1枚使う</b>。となりに人がいれば、移動のかわりに攻撃もできる。</li>
        <li>攻撃された人は、手札の<b>防具</b>を出して受ける。出した枚数だけ引き直せる。</li>
        <li>HP ${START_HP} から始めて、0 になったら脱落（回復の上限は ${MAX_HP}）。</li>
      </ul>
      <h3>移動とひろう</h3>
      <ul>
        <li>たて・よこに1マス動きます。人のいるマスと岩かべには入れません。<b>その場にはとどまれません</b>（どこへも動けないときだけ、とどまれます）。</li>
        <li>動いたあと、立っているマスの地形から神器を1枚ひろいます。手札は ${START_HAND}枚から始まり、${HAND_LIMIT}枚まで。</li>
        <li>手札が ${HAND_LIMIT}枚のときは、古い神器を1枚すててひろうか、ひろわないかを選びます。</li>
      </ul>
      <h3>移動のかわりに攻撃</h3>
      <ul>
        <li>となり（たて・よこの4マス。移動できる範囲と同じ）に人がいるときは、移動のかわりに、<b>その人に当たる武器</b>を使えます。</li>
        <li>そのあと、いつもどおり神器を1枚使えます。つまり、1ターンに2回使えます。</li>
        <li>動かないので、そのターンは神器をひろえません。溶岩や魔界の上なら、ダメージは受けます。</li>
      </ul>
      <h3>地形</h3>
      <ul>
        <li><b>🌾 平地</b>：近くを攻める武器と、木のたて。</li>
        <li><b>🌲 森</b>：遠くやななめを攻める武器。森にいると、受けるダメージ −${FOREST_COVER}。</li>
        <li><b>⛰️ 山</b>：重い武器と、かたい防具。山にいると、自分の攻撃の威力 +${MOUNTAIN_EDGE}。</li>
        <li><b>⛲ 泉</b>：回復と、霧のころも。泉にいると、番の初めに HP+${SPRING_HEAL}。</li>
        <li><b>🏛️ 遺跡</b>：地形を変えたり、場所を入れかえたりする奇跡。</li>
        <li><b>🔮 予言の地</b>：盤に1マスだけ。入ると<b>特別な神器</b>（全員に当たる「天のさばき」、威力11で貫通する「竜のいぶき」、ダメージ −12 の「神のたて」、HP+20 の「命の実」、何が起きるかわからない「ふしぎな箱」）をひろえます。入られると消えて元の地形にもどり、${ORACLE_WAIT}ターン後に、どこか別のマスに現れます。奇跡で変えることはできません。</li>
        <li><b>🎁 ふしぎな箱</b>（予言の地でひろえる）：使うと、次のどれか1つがランダムに起きます。${Object.values(CHAOS).map((text) => `「${text}」`).join('')}。手札がいっぱいになるのは、使った人だけ。流れ星はランダムな ${METEORS}マスに落ちて威力 ${METEOR_POWER}（防具では受けられず、使った本人に当たることもあります）。1周だけの魔界は、生きている人が1回ずつ番をしたら消えて、地形は元にもどります。</li>
        <li><b>🌋 溶岩</b>：威力の高い武器。ただし、移動のあとここにいると ${TERRAINS.lava.hurt}ダメージ。</li>
      </ul>
      <h3>攻撃と防御</h3>
      <ul>
        <li>武器は、たて・よこの直線、ななめ、まわり8マスなど、形が決まっています。向きのある武器は、向きを1つえらびます。</li>
        <li><b>貫通</b>の武器は、線の上の全員に当たります。貫通でない武器は、最初の1人で止まります。</li>
        <li><b>岩かべ</b>は、どの武器も受け止めます。耐久力は ${WALL_HP} で、当たった武器の威力だけ減り、0 になるとこわれて平地になります。</li>
        <li><b>遠い相手には、外れることがあります。</b>となり（ななめもふくむ）なら必ず当たり、1マス遠くなるごとに命中率が下がります。下がり方は、威力5以下の武器は10%ずつ、威力6〜8は15%ずつ、威力9以上は20%ずつ。たとえば「ゆみ」（威力5）は4マス先でも70%、「竜のいぶき」（威力11）は4マス先だと40%です。命中率は、使う前にボタンに出ます。「天のさばき」だけは必ず当たります。</li>
        <li>攻撃された人は、防具を何枚でも出せます。ダメージは「威力 − 防具の合計」。</li>
        <li>出した防具の枚数だけ、足もとの地形から引き直します。</li>
      </ul>
      <h3>魔界</h3>
      <p>${MAKAI_TURN}ターンをすぎると、全部のマスが魔界になります。どこにいても毎ターン ${TERRAINS.makai.hurt}ダメージ。ひろえるのは魔界の神器だけになり、地形はもう変えられません。</p>
      <h3>コツ</h3>
      <ul>
        <li>ほかの人と、たて・よこ・ななめに並ぶと、ねらわれます。並ばない位置に立つのが守りの基本です。</li>
        <li>防具は出しても引き直せるので、けちらずに出しましょう。ただし、溶岩の上では防具がひろえません。</li>
        <li>向きのボタンの「●」は、その向きにだれかがいる印です。</li>
      </ul>
    </div>
  `;
}

export default {
  Board,
  Rules,
  scores: (view) => view.hp,
  unit: 'HP',
  progress: (view) => (view.makai ? `魔界・ターン ${view.turnNo}` : `ターン ${view.turnNo}`),
  waiting: () => false,
  turnSound: false,
  extra: (view, s) => (view.alive[s] ? `手札 ${view.handCount[s]}枚` : '脱落'),
};
