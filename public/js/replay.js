// 「全員が出そろったあと、1つずつ順に見せる」場面のための数え役。

import { useState, useEffect, useRef } from './lib.js';

/**
 * active のあいだ、id の番のなりゆきを lead ミリ秒後から step ミリ秒おきに1つずつ進める。
 * 戻り値は「見せ終えた数」(0〜count)。見せる場面でなければ null。
 * onStep(i) は i 番目を見せた瞬間に呼ばれる (効果音などに使う)。
 */
export function useReplay(active, id, count, { lead, step }, onStep) {
  const [progress, setProgress] = useState({ id: null, shown: 0 });
  const callback = useRef(onStep);
  callback.current = onStep;

  useEffect(() => {
    if (!active) return undefined;
    let shown = 0;
    setProgress({ id, shown });
    let timer = setTimeout(function next() {
      callback.current?.(shown);
      shown++;
      setProgress({ id, shown });
      if (shown < count) timer = setTimeout(next, step);
    }, lead);
    return () => clearTimeout(timer);
  }, [active, id]);

  if (!active) return null;
  return progress.id === id ? progress.shown : 0;
}
