// ルームの参加・再接続・進行を、偽の接続を使って確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, CLOSE_REPLACED, CLOSE_KICKED } from '../server/rooms.js';
import { mulberry32 } from '../shared/rng.js';

function fakeConn() {
  const conn = {
    messages: [],
    closed: null,
    send(msg) {
      conn.messages.push(JSON.parse(JSON.stringify(msg)));
    },
    close(code) {
      conn.closed = code;
    },
    last(type = 'state') {
      return conn.messages.filter((m) => m.t === type).at(-1);
    },
  };
  return conn;
}

function setup(names = ['あや', 'けん']) {
  let clock = 1_000_000;
  const manager = new RoomManager({ rng: mulberry32(42), botDelay: () => 1, now: () => clock });
  const room = manager.createRoom();
  const members = names.map((name, i) => {
    const conn = fakeConn();
    const player = room.join(conn, { clientId: `client-${i}-xxxx`, name });
    return { conn, player };
  });
  return { manager, room, members, tick: (ms) => (clock += ms) };
}

test('ルームを作ると最初の人がホストになり、全員に状態が届く', () => {
  const { room, members } = setup();
  const [a, b] = members;
  assert.match(room.code, /^[A-Z2-9]{4}$/);
  const state = b.conn.last();
  assert.equal(state.room.hostId, a.player.id);
  assert.equal(state.you, b.player.id);
  assert.deepEqual(state.room.players.map((p) => p.name), ['あや', 'けん']);
  assert.deepEqual(state.room.players.map((p) => p.color), [0, 1]);
  assert.equal(JSON.stringify(state.room).includes('client-'), false, '他人の接続 ID は配らない');
});

test('ホスト以外はゲームを選んだり始めたりできない', () => {
  const { room, members } = setup();
  const [, b] = members;
  room.handle(b.player, { t: 'setGame', gameId: 'dokan' });
  assert.equal(room.gameId, 'toudai');
  assert.match(b.conn.last('error').message, /ホスト/);
  room.handle(b.player, { t: 'start' });
  assert.equal(room.phase, 'lobby');
});

test('人数が足りないと始められず、CPU を足すと始められる', () => {
  const { room, members } = setup(['あや']);
  const [a] = members;
  room.handle(a.player, { t: 'setGame', gameId: 'gottsunko' });
  room.handle(a.player, { t: 'start' });
  assert.equal(room.phase, 'lobby');
  assert.match(a.conn.last('error').message, /2人から/);

  room.handle(a.player, { t: 'addBot' });
  room.handle(a.player, { t: 'start' });
  assert.equal(room.phase, 'playing');
  const state = a.conn.last();
  assert.equal(state.game.id, 'gottsunko');
  assert.equal(state.game.seats.length, 2);
  assert.equal(state.game.seats[state.game.seat], a.player.id);
});

test('CPU が自動で動き、ゲームが最後まで進む', async () => {
  const { room, members } = setup(['あや']);
  const [a] = members;
  room.handle(a.player, { t: 'setGame', gameId: 'gottsunko' });
  room.handle(a.player, { t: 'addBot' });
  room.handle(a.player, { t: 'start' });

  for (let i = 0; i < 400 && room.phase === 'playing'; i++) {
    const { game } = a.conn.last();
    if (game.pending.includes(game.seat)) {
      // 自分の番は CPU の頭を借りて適当に進める。
      room.handle(a.player, { t: 'cpuMove', playerId: a.player.id });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
  }
  assert.equal(room.phase, 'finished');
  const final = a.conn.last();
  assert.equal(final.game.view.over, true);
  assert.equal(final.game.view.result.scores.length, 2);

  room.handle(a.player, { t: 'rematch' });
  assert.equal(room.phase, 'playing');
  room.handle(a.player, { t: 'toLobby' });
  assert.equal(room.phase, 'lobby');
  assert.equal(a.conn.last().game, null);
});

test('非公開の情報は本人にしか届かない', () => {
  const { room, members } = setup(['あや', 'けん', 'みお']);
  const [a] = members;
  room.handle(a.player, { t: 'setGame', gameId: 'dokan' });
  room.handle(a.player, { t: 'start' });
  const fuse = room.game.state.fuse;
  for (const m of members) {
    const { game } = m.conn.last();
    assert.equal(game.view.fuse, null);
    assert.equal(game.view.myPeek.value, fuse[game.view.myPeek.index]);
    assert.equal(JSON.stringify(game).includes('"fuse":['), false);
  }
});

test('切断しても席は残り、同じ ID で戻れる。別タブで開くと古い方が閉じられる', () => {
  const { room, members } = setup();
  const [a, b] = members;
  room.handle(a.player, { t: 'start' });
  room.disconnect(b.player, b.conn);
  assert.equal(a.conn.last().room.players[1].connected, false);

  const again = fakeConn();
  const back = room.join(again, { clientId: 'client-1-xxxx', name: 'けん' });
  assert.equal(back.id, b.player.id);
  assert.equal(a.conn.last().room.players[1].connected, true);
  assert.ok(again.last().game.seat >= 0);

  const third = fakeConn();
  room.join(third, { clientId: 'client-1-xxxx' });
  assert.equal(again.closed, CLOSE_REPLACED);
  assert.equal(room.players.length, 2);
});

test('同じブラウザで開き直すと、切断中の元の席に戻る', () => {
  const { room, members } = setup();
  const [, b] = members;
  // 元の席がつながっているあいだは、新しい人として入る。
  const other = fakeConn();
  const extra = room.join(other, { clientId: 'fresh-tab-0001', altClientId: 'client-1-xxxx', name: 'べつタブ' });
  assert.notEqual(extra.id, b.player.id);
  assert.equal(room.players.length, 3);

  room.disconnect(b.player, b.conn);
  const reopened = fakeConn();
  const back = room.join(reopened, { clientId: 'fresh-tab-0002', altClientId: 'client-1-xxxx' });
  assert.equal(back.id, b.player.id);
  assert.equal(reopened.last().clientId, 'client-1-xxxx');
});

test('ゲーム中に来た人は観戦になり、切断中の席を引き継げる', () => {
  const { room, members } = setup();
  const [a, b] = members;
  room.handle(a.player, { t: 'start' });

  const watcher = fakeConn();
  let session = room.join(watcher, { clientId: 'watcher-00001', name: 'みお' });
  watcher.rebind = (p) => (session = p);
  assert.equal(session.spectator, true);
  assert.equal(watcher.last().game.seat, -1);
  room.handle(session, { t: 'action', action: { type: 'place', cell: 0, kind: 'plus' } });
  assert.match(watcher.last('error').message, /観戦/);

  room.handle(session, { t: 'takeover', playerId: b.player.id });
  assert.match(watcher.last('error').message, /引き継げません/, 'つながっている席は取れない');

  room.disconnect(b.player, b.conn);
  room.handle(session, { t: 'takeover', playerId: b.player.id });
  assert.equal(session.id, b.player.id);
  assert.equal(watcher.last().you, b.player.id);
  assert.ok(watcher.last().game.seat >= 0);
  assert.equal(room.players.length, 2);
  assert.equal(room.players.find((p) => p.id === b.player.id).name, 'みお');
});

test('ホストが抜けると次の人に引き継がれ、キックもできる', () => {
  const { room, members } = setup(['あや', 'けん', 'みお']);
  const [a, b, c] = members;
  room.handle(a.player, { t: 'kick', playerId: c.player.id });
  assert.equal(c.conn.closed, CLOSE_KICKED);
  assert.equal(room.players.length, 2);

  room.leave(a.player);
  assert.equal(room.hostId, b.player.id);
  assert.equal(room.players.length, 1);
});

test('だれもいなくなったルームは時間が経つと消える', () => {
  const { manager, room, members, tick } = setup(['あや']);
  const [a] = members;
  room.disconnect(a.player, a.conn);
  tick(60_000);
  manager.sweep();
  assert.equal(manager.rooms.size, 1);
  tick(15 * 60_000);
  manager.sweep();
  assert.equal(manager.rooms.size, 0);
  assert.equal(manager.getRoom(room.code), null);
});

test('切断したまま戻らない人は、ロビーでは時間が経つと外れる', () => {
  const { manager, room, members, tick } = setup();
  const [, b] = members;
  room.disconnect(b.player, b.conn);
  tick(30_000);
  manager.sweep();
  assert.equal(room.players.length, 2, '少しの切断では外さない');
  tick(3 * 60_000);
  manager.sweep();
  assert.equal(room.players.length, 1);
});

test('名前は整えられ、長すぎる名前は切られる', () => {
  const { room, members } = setup(['  あ\n や  ']);
  assert.equal(members[0].player.name, 'あ や');
  room.handle(members[0].player, { t: 'rename', name: 'あ'.repeat(40) });
  assert.equal(members[0].player.name.length, 12);
  room.handle(members[0].player, { t: 'rename', name: '   ' });
  assert.equal(members[0].player.name, 'ゲスト');
});
