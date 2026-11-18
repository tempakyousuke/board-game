// わさび係はだれだ — ロシアンたこパと同じ進め方で、わさびを入れるのが毎回ランダムな1人だけ (4〜6人)
//
// ・仕込みでは、全員が「自分が係になったら、何番目に入れるか」を先に決める。
//   そのあとで係が1人こっそり決まり、その人の皿にだけ、決めておいた場所へわさびが入る。
//   (全員が同じ操作をするので、だれが係かは手つきからはわからない。)
// ・係でない人の皿は、かならず安全。「わさびは、自分以外のだれか1人の皿にある」と全員が知っている。
// ・宣言・賭け・挑戦・得点は、ロシアンたこパと同じ。

import * as core from './takopa.js';

export const meta = {
  id: 'wasabi',
  name: 'わさび係はだれだ',
  emoji: '🕵️',
  tagline: 'わさび入りの皿は1つだけ。宣言のしかたから、係を見ぬけ',
  minPlayers: 4,
  maxPlayers: 6,
  time: '10分',
  tags: ['わいわい', '推理', 'ブラフ'],
};

export function setup(args) {
  return core.setupWith(args, 'role');
}

export const { act, view, pending, bot } = core;
