// ゲームモジュール共通のヘルパー。
//
// 各ゲームは次の関数を export する:
//   meta                      … 表示用の情報と人数
//   setup({ n, rng })         … 初期状態を作る
//   act(state, seat, action, rng) … 行動を適用する (不正なら GameError を投げる)
//   view(state, seat)         … その席から見える情報だけを返す (観戦者は seat = -1)
//   pending(state)            … いま行動待ちの席の一覧
//   bot(state, seat, rng)     … CPU の行動を返す
// 状態はすべて JSON 化できるプレーンなオブジェクトにしておく。

export class GameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameError';
  }
}

export function assert(cond, message) {
  if (!cond) throw new GameError(message);
}

/**
 * スコアから順位を作る (同点は同順位)。
 * tiebreak を渡すと、スコアが同じときにその値が大きい方を上位にする。
 * @param {number[]} scores
 * @param {boolean} higherIsBetter
 * @param {number[] | null} tiebreak
 * @returns {number[]} 席ごとの順位 (1 始まり)
 */
export function placesFromScores(scores, higherIsBetter = true, tiebreak = null) {
  const beats = (a, b) => {
    if (scores[a] !== scores[b]) return higherIsBetter ? scores[a] > scores[b] : scores[a] < scores[b];
    return tiebreak ? tiebreak[a] > tiebreak[b] : false;
  };
  return scores.map((_, seat) => {
    let better = 0;
    for (let other = 0; other < scores.length; other++) {
      if (other !== seat && beats(other, seat)) better++;
    }
    return better + 1;
  });
}

export function makeResult(scores, { higherIsBetter = true, unit = '点', detail = null, tiebreak = null } = {}) {
  const places = placesFromScores(scores, higherIsBetter, tiebreak);
  return {
    scores,
    places,
    winners: places.map((p, i) => (p === 1 ? i : -1)).filter((i) => i >= 0),
    unit,
    detail,
  };
}
