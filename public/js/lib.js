// Preact + htm をまとめた1ファイルを node_modules から配信している (ビルド不要)。
export {
  html,
  render,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from '/vendor/htm-preact.js';

/** 条件つきでクラス名をつなげる。 */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}
