// 乱数ユーティリティ。ゲームロジックは rng() (0以上1未満) を受け取るので、
// テストではシード付き乱数に差し替えて再現性を確保できる。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

export function pick(rng, arr) {
  return arr[randInt(rng, arr.length)];
}

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** pairs: [[value, weight], ...] */
export function weighted(rng, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let x = rng() * total;
  for (const [v, w] of pairs) {
    x -= w;
    if (x < 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
