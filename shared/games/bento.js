// つめつめ弁当 — まわってくるおかずを選んで、お弁当箱につめるゲーム (2〜6人)
//
// ・全員が手札から同時に1つ選び、自分の 3×3 のお弁当箱の好きなマスにつめる。
// ・残った手札はとなりの人にまわす。これを9回くり返すとお弁当が完成。
// ・おかずは種類ごとに点の入り方がちがう (となりに何があるか、いくつ集めたか、など)。
// ・最後は手札が2枚しかないので、欲しくないピーマンを押しつけ合うことになる。
// ・合計点がいちばん高い人の勝ち。

import { assert, makeResult } from './common.js';
import { shuffle } from '../rng.js';

export const meta = {
  id: 'bento',
  name: 'つめつめ弁当',
  emoji: '🍱',
  tagline: 'まわってくるおかずを1つ選んで、お弁当箱にどうつめる？',
  minPlayers: 2,
  maxPlayers: 6,
  time: '5〜10分',
  tags: ['わいわい', 'ドラフト', '同時プレイ'],
};

export const SIZE = 3;
export const CELLS = SIZE * SIZE;
export const CENTER = 4;
export const HAND_SIZE = 10; // 9つ選ぶと1枚残る。最後の1つまで「どちらを取るか」が残るように。

export const KARAAGE_FIRST = 7;
export const KARAAGE_SECOND = 3;
const EBI_POINTS = [0, 1, 4, 10];
export const TAMAGO_PAIR = 5;

/** おかずの一覧。weight は手札 11 枚あたりの枚数の目安。 */
export const FOODS = {
  onigiri: { emoji: '🍙', name: 'おにぎり', rule: 'となりのおかず1つにつき1点', weight: 2 },
  tamago: { emoji: '🍳', name: 'たまごやき', rule: `となり合うたまごやき1組につき${TAMAGO_PAIR}点`, weight: 2 },
  ebi: { emoji: '🍤', name: 'エビフライ', rule: '1本で1点、2本で4点、3本以上で10点', weight: 1.5 },
  tomato: { emoji: '🍅', name: 'ミニトマト', rule: 'まわり8マスにトマトがなければ3点', weight: 1.5 },
  broccoli: { emoji: '🥦', name: 'ブロッコリー', rule: 'となりにあるおかずの種類の数だけ点', weight: 1.5 },
  karaage: { emoji: '🍗', name: 'からあげ', rule: `数がいちばん多い人に${KARAAGE_FIRST}点、2番目に${KARAAGE_SECOND}点（同数なら山分け）`, weight: 1.5 },
  ume: { emoji: '🔴', name: 'うめぼし', rule: 'まんなかに置けば6点、ほかは1点', weight: 0.7 },
  piman: { emoji: '🫑', name: 'ピーマン', rule: '1つにつき−2点。でも3つ以上あつめると1つにつき+2点', weight: 1.3 },
};
export const FOOD_IDS = Object.keys(FOODS);

function neighbors(cell, diagonal = false) {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (!diagonal && dr !== 0 && dc !== 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) continue;
      out.push(rr * SIZE + cc);
    }
  }
  return out;
}
const ORTH = Array.from({ length: CELLS }, (_, i) => neighbors(i));
const AROUND = Array.from({ length: CELLS }, (_, i) => neighbors(i, true));

/**
 * お弁当箱1つぶんの点 (からあげの順位点は人との比較なので含めない)。
 * @returns {{ parts: Record<string, number>, karaage: number }}
 */
export function scoreBox(box) {
  const parts = { onigiri: 0, tamago: 0, ebi: 0, tomato: 0, broccoli: 0, karaage: 0, ume: 0, piman: 0 };
  let ebi = 0;
  let karaage = 0;
  let piman = 0;
  for (let i = 0; i < CELLS; i++) {
    const food = box[i];
    if (!food) continue;
    if (food === 'onigiri') {
      parts.onigiri += ORTH[i].filter((j) => box[j] && box[j] !== 'onigiri').length;
    } else if (food === 'tamago') {
      // 1組を両側から数えることになるので、ここでは組の数の2倍をためて、あとで点に直す。
      parts.tamago += ORTH[i].filter((j) => box[j] === 'tamago').length;
    } else if (food === 'ebi') {
      ebi++;
    } else if (food === 'tomato') {
      if (!AROUND[i].some((j) => box[j] === 'tomato')) parts.tomato += 3;
    } else if (food === 'broccoli') {
      parts.broccoli += new Set(ORTH[i].map((j) => box[j]).filter((f) => f && f !== 'broccoli')).size;
    } else if (food === 'karaage') {
      karaage++;
    } else if (food === 'ume') {
      parts.ume += i === CENTER ? 6 : 1;
    } else if (food === 'piman') {
      piman++;
    }
  }
  parts.tamago = (parts.tamago / 2) * TAMAGO_PAIR;
  parts.ebi = EBI_POINTS[Math.min(ebi, EBI_POINTS.length - 1)];
  // きらいなピーマンも、3つ食べれば「好ききらいなし」でほめられる。
  parts.piman = piman >= 3 ? piman * 2 : piman * -2;
  return { parts, karaage };
}

/**
 * 全員ぶんの点。からあげは数の多い順に 1位・2位へ点が入る。
 * 1位が同数なら 1位の点を山分けして 2位はなし、2位が同数なら 2位の点を山分け (端数切り捨て)。
 */
export function scoreAll(boxes) {
  const each = boxes.map(scoreBox);
  const counts = [...new Set(each.map((e) => e.karaage).filter((k) => k > 0))].sort((a, b) => b - a);
  const firsts = each.filter((e) => e.karaage === counts[0]).length;
  const seconds = each.filter((e) => e.karaage === counts[1]).length;
  return each.map(({ parts, karaage }) => {
    if (karaage > 0 && karaage === counts[0]) parts.karaage = Math.floor(KARAAGE_FIRST / firsts);
    else if (karaage > 0 && karaage === counts[1] && firsts === 1) parts.karaage = Math.floor(KARAAGE_SECOND / seconds);
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return { parts, karaage, total };
  });
}

function buildDeck(n, rng) {
  const size = HAND_SIZE * n;
  const totalWeight = FOOD_IDS.reduce((sum, id) => sum + FOODS[id].weight, 0);
  const deck = [];
  for (const id of FOOD_IDS) {
    const count = Math.floor((FOODS[id].weight / totalWeight) * size);
    for (let k = 0; k < count; k++) deck.push(id);
  }
  // 端数は種類が偏らないよう順番に足す。
  const extra = shuffle(rng, FOOD_IDS);
  for (let k = 0; deck.length < size; k++) deck.push(extra[k % extra.length]);
  return shuffle(rng, deck);
}

export function setup({ n, rng }) {
  const deck = buildDeck(n, rng);
  return {
    n,
    turn: 1,
    maxTurns: CELLS,
    hands: Array.from({ length: n }, (_, s) => deck.slice(s * HAND_SIZE, (s + 1) * HAND_SIZE)),
    boxes: Array.from({ length: n }, () => new Array(CELLS).fill(null)),
    choice: new Array(n).fill(null),
    last: [],
    over: false,
    result: null,
  };
}

export function act(state, seat, action) {
  assert(!state.over, 'ゲームは終了しています');
  assert(seat >= 0 && seat < state.n, '観戦中は操作できません');
  assert(action && action.type === 'pack', '不明な操作です');
  const { tile, cell } = action;
  assert(Number.isInteger(tile) && tile >= 0 && tile < state.hands[seat].length, 'おかずを選んでください');
  assert(Number.isInteger(cell) && cell >= 0 && cell < CELLS, 'マスが正しくありません');
  assert(state.boxes[seat][cell] === null, 'そのマスにはもう入っています');
  state.choice[seat] = { tile, cell };
  if (state.choice.every((c) => c !== null)) resolve(state);
}

function resolve(state) {
  const { n } = state;
  state.last = [];
  for (let s = 0; s < n; s++) {
    const { tile, cell } = state.choice[s];
    const [food] = state.hands[s].splice(tile, 1);
    state.boxes[s][cell] = food;
    state.last.push({ seat: s, food, cell });
  }
  state.choice = new Array(n).fill(null);

  if (state.turn >= state.maxTurns) {
    state.hands = state.hands.map(() => []);
    state.over = true;
    const scores = scoreAll(state.boxes);
    state.result = makeResult(
      scores.map((s) => s.total),
      { unit: '点', detail: { parts: scores.map((s) => s.parts) } },
    );
    return;
  }
  // 残りの手札を次の席にまわす。
  state.hands = state.hands.map((_, s) => state.hands[(s - 1 + n) % n]);
  state.turn++;
}

export function view(state, seat) {
  const mine = seat >= 0 && seat < state.n;
  const scores = scoreAll(state.boxes);
  return {
    n: state.n,
    turn: state.turn,
    maxTurns: state.maxTurns,
    boxes: state.boxes,
    hand: mine ? state.hands[seat] : [],
    handSize: state.hands[0]?.length ?? 0,
    submitted: state.choice.map((c) => c !== null),
    myChoice: mine ? state.choice[seat] : null,
    last: state.last,
    scores: scores.map((s) => s.total),
    parts: scores.map((s) => s.parts),
    karaage: scores.map((s) => s.karaage),
    over: state.over,
    result: state.result,
  };
}

export function pending(state) {
  if (state.over) return [];
  return state.choice.map((c, s) => (c === null ? s : -1)).filter((s) => s >= 0);
}

/** そのマスに置いたあと、まだ伸びしろがどれくらいあるかの見積もり。 */
function potential(box, food, cell, picksLeft) {
  const emptyOrth = ORTH[cell].filter((j) => box[j] === null).length;
  const late = picksLeft <= 2 ? 0.3 : 1;
  switch (food) {
    case 'onigiri':
      return emptyOrth * 0.6 * late;
    case 'broccoli':
      return emptyOrth * 0.55 * late;
    case 'tamago':
      // 相方がまだいないなら、となりが空いているほど組を作りやすい。
      return ORTH[cell].some((j) => box[j] === 'tamago') ? emptyOrth * 0.5 * late : Math.min(emptyOrth, 2) * 0.9 * late;
    case 'ebi': {
      const have = box.filter((f) => f === 'ebi').length;
      return have < 3 ? 1.2 * late : 0;
    }
    case 'tomato':
      // トマトは角に置くと、ほかのおかずの邪魔になりにくい。
      return ORTH[cell].length === 2 ? 0.4 : cell === CENTER ? -1.5 : 0;
    case 'karaage':
      return 0.8;
    case 'piman': {
      // 2つ持っていれば、3つ目で一気にプラスになる。そこまで遠ければ手を出さない。
      const have = box.filter((f) => f === 'piman').length;
      return have === 2 && picksLeft >= 2 ? 3 : have === 1 ? 0 : -1;
    }
    default:
      return 0;
  }
}

export function bot(state, seat, rng) {
  const box = state.boxes[seat];
  const hand = state.hands[seat];
  const picksLeft = state.maxTurns - state.turn;
  const before = scoreAll(state.boxes)[seat].total;
  let best = null;
  let bestValue = -Infinity;
  const seen = new Set();
  for (let tile = 0; tile < hand.length; tile++) {
    const food = hand[tile];
    if (seen.has(food)) continue; // 同じおかずは1回調べれば十分
    seen.add(food);
    for (let cell = 0; cell < CELLS; cell++) {
      if (box[cell] !== null) continue;
      box[cell] = food;
      const gain = scoreAll(state.boxes)[seat].total - before;
      const value = gain + potential(box, food, cell, picksLeft) + rng() * 0.8;
      box[cell] = null;
      // まんなかは点の高いマスなので、中途半端なものでふさがない。
      const penalty = cell === CENTER && food !== 'ume' && food !== 'onigiri' && food !== 'broccoli' && picksLeft > 2 ? 1.5 : 0;
      if (value - penalty > bestValue) {
        bestValue = value - penalty;
        best = { type: 'pack', tile, cell };
      }
    }
  }
  return best;
}
