// ルーム (卓) の管理。ゲームの進行はすべてサーバーが持ち、
// クライアントには「その人から見える情報」だけを送る。
//
// ソケットには直接触らず、send(obj) / close(code, reason) を持つ「接続」を受け取る。
// こうしておくとテストで偽の接続を差し込める。

import { randomBytes, randomInt } from 'node:crypto';
import { GAMES } from '../shared/games/index.js';
import { GameError } from '../shared/games/common.js';
import { MAX_PLAYERS } from '../shared/palette.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O, 1/I のような紛らわしい文字は使わない
const CODE_LENGTH = 4;
const MAX_ROOMS = 500;
const MAX_MEMBERS = 12; // 観戦者を含めた1ルームの上限
const NAME_MAX = 12;
const EMPTY_ROOM_TTL = 15 * 60 * 1000;
const HOST_GRACE = 15 * 1000;
const GHOST_TTL = 2 * 60 * 1000; // 切断したまま戻らない人を席から外すまでの時間
const EMOTES = ['👍', '😂', '😱', '🎉', '🤔', '🙏'];

export const CLOSE_REPLACED = 4001; // 別のタブから同じ席に入った
export const CLOSE_KICKED = 4002;
export const CLOSE_LEFT = 4003;

export class RoomError extends Error {}

function cleanName(raw) {
  const name = (typeof raw === 'string' ? raw : '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(name).slice(0, NAME_MAX).join('') || 'ゲスト';
}

function validClientId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

export class RoomManager {
  /**
   * @param {{ rng?: () => number, botDelay?: () => number, now?: () => number }} options
   */
  constructor(options = {}) {
    this.rooms = new Map();
    this.rng = options.rng ?? Math.random;
    this.botDelay = options.botDelay ?? (() => 800 + Math.random() * 700);
    this.now = options.now ?? Date.now;
  }

  createRoom() {
    if (this.rooms.size >= MAX_ROOMS) {
      throw new RoomError('いまはルームがいっぱいです。少し待ってからもう一度お試しください');
    }
    let code;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(String(code ?? '').toUpperCase().trim()) ?? null;
  }

  /** 人がいなくなってしばらく経ったルームを片付ける。 */
  sweep() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (!room.hasConnectedHuman()) {
        if (now - room.emptySince >= EMPTY_ROOM_TTL) room.destroy();
        continue;
      }
      if (room.phase !== 'playing' && room.prune()) room.broadcast();
    }
  }

  stats() {
    let players = 0;
    for (const room of this.rooms.values()) players += room.players.filter((p) => p.conn).length;
    return { rooms: this.rooms.size, players };
  }
}

export class Room {
  constructor(code, manager) {
    this.code = code;
    this.manager = manager;
    this.players = [];
    this.hostId = null;
    this.gameId = Object.keys(GAMES)[0];
    this.phase = 'lobby'; // lobby | playing | finished
    this.game = null; // { id, seats: [playerId], state, since }
    this.botTimer = null;
    this.tickTimer = null;
    this.tickKey = null;
    this.hostTimer = null;
    this.emptySince = manager.now();
    this.botCount = 0;
    this.gameCount = 0;
  }

  // ---- 参加・退出 -------------------------------------------------------

  hasConnectedHuman() {
    return this.players.some((p) => !p.bot && p.conn);
  }

  activePlayers() {
    return this.players.filter((p) => !p.spectator);
  }

  freeColor() {
    const used = new Set(this.activePlayers().map((p) => p.color));
    for (let c = 0; c < MAX_PLAYERS; c++) if (!used.has(c)) return c;
    return -1;
  }

  /**
   * @param {{ send: (msg: object) => void, close: (code?: number, reason?: string) => void }} conn
   * @param {{ clientId: string, altClientId?: string, name?: string }} info
   * @returns {object} 参加したプレイヤー
   */
  join(conn, info) {
    if (!validClientId(info.clientId)) throw new RoomError('接続情報が正しくありません');

    let player = this.players.find((p) => p.clientId === info.clientId);
    // 同じブラウザで開き直したとき (タブごとの ID は変わる) は、切断中の元の席に戻す。
    if (!player && validClientId(info.altClientId)) {
      player = this.players.find((p) => p.clientId === info.altClientId && !p.conn) ?? null;
    }

    if (player) {
      if (player.conn && player.conn !== conn) {
        const old = player.conn;
        player.conn = null;
        old.close(CLOSE_REPLACED, 'replaced');
      }
      if (info.name) player.name = cleanName(info.name);
    } else {
      if (this.players.length >= MAX_MEMBERS) throw new RoomError('このルームは満員です');
      // 進行中のゲームには入れないので観戦から。席が埋まっているときも観戦になる。
      const spectator = this.phase !== 'lobby' || this.activePlayers().length >= MAX_PLAYERS;
      player = {
        id: randomBytes(6).toString('base64url'),
        clientId: info.clientId,
        name: cleanName(info.name),
        color: spectator ? -1 : this.freeColor(),
        bot: false,
        spectator,
        conn: null,
      };
      this.players.push(player);
    }

    player.conn = conn;
    player.leftAt = null;
    // ホストがいない、または長く席を外しているなら、入ってきた人がホストを引き継ぐ。
    const host = this.players.find((p) => p.id === this.hostId);
    const hostGone = !host || (!host.conn && this.manager.now() - (host.leftAt ?? 0) >= HOST_GRACE);
    if (hostGone) this.migrateHost();
    this.scheduleTick(); // だれもいなくて止まっていた時計を動かす
    this.broadcast();
    return player;
  }

  /** ソケットが切れたとき。席は残しておき、戻ってきたら続きから遊べる。 */
  disconnect(player, conn) {
    if (player.conn !== conn) return; // すでに別の接続に置き換わっている
    player.conn = null;
    player.leftAt = this.manager.now();
    if (!this.players.includes(player)) return;

    // ロビーにいる観戦者は残しておく意味がないので消す。
    if (player.spectator && this.phase === 'lobby') this.removePlayer(player);
    if (!this.hasConnectedHuman()) {
      this.emptySince = this.manager.now();
      this.stopTick();
    }
    if (player.id === this.hostId) this.scheduleHostMigration();
    this.broadcast();
  }

  /** 自分から「退出」を押したとき。 */
  leave(player) {
    const conn = player.conn;
    player.conn = null;
    player.leftAt = 0; // 自分から出た人は、すぐに「戻ってこない人」として扱う
    // 対戦中の席は消さずに切断扱いにして、ゲームが壊れないようにする。
    if (!this.isSeated(player)) this.removePlayer(player);
    if (player.id === this.hostId) this.migrateHost();
    if (!this.hasConnectedHuman()) this.emptySince = this.manager.now();
    conn?.close(CLOSE_LEFT, 'left');
    this.broadcast();
  }

  removePlayer(player) {
    const index = this.players.indexOf(player);
    if (index >= 0) this.players.splice(index, 1);
  }

  /** 進行中のゲームの席についているか。 */
  isSeated(player) {
    return this.phase === 'playing' && !!this.game?.seats.includes(player.id);
  }

  /** 切断したまま、しばらく戻ってきていない人か。 */
  isGhost(player) {
    if (player.bot || player.conn) return false;
    return this.manager.now() - (player.leftAt ?? 0) >= GHOST_TTL;
  }

  /**
   * 戻ってこない人を外す。進行中のゲームの席は、ゲームが壊れないよう残しておく。
   * @returns {boolean} だれかを外したか
   */
  prune() {
    const before = this.players.length;
    this.players = this.players.filter((p) => !this.isGhost(p) || this.isSeated(p));
    if (!this.players.some((p) => p.id === this.hostId)) this.migrateHost();
    return this.players.length !== before;
  }

  scheduleHostMigration() {
    clearTimeout(this.hostTimer);
    this.hostTimer = setTimeout(() => {
      const host = this.players.find((p) => p.id === this.hostId);
      if (!host || !host.conn) {
        this.migrateHost();
        this.broadcast();
      }
    }, HOST_GRACE);
    this.hostTimer.unref?.();
  }

  migrateHost() {
    const candidates = this.players.filter((p) => !p.bot && p.conn);
    const next = candidates.find((p) => !p.spectator) ?? candidates[0];
    if (next) this.hostId = next.id;
  }

  destroy() {
    this.stopTick();
    clearTimeout(this.botTimer);
    clearTimeout(this.hostTimer);
    for (const p of this.players) p.conn?.close(CLOSE_LEFT, 'room closed');
    this.manager.rooms.delete(this.code);
  }

  // ---- メッセージ処理 ---------------------------------------------------

  /** クライアントからの操作を処理する。失敗したら本人にだけエラーを返す。 */
  handle(player, msg) {
    try {
      this.dispatch(player, msg);
    } catch (err) {
      if (err instanceof RoomError || err instanceof GameError) {
        player.conn?.send({ t: 'error', message: err.message });
      } else {
        console.error(`[room ${this.code}]`, err);
        player.conn?.send({ t: 'error', message: 'サーバーでエラーが起きました' });
      }
    }
  }

  requireHost(player) {
    if (player.id !== this.hostId) throw new RoomError('ホストだけができる操作です');
  }

  requireLobby() {
    if (this.phase !== 'lobby') throw new RoomError('ゲーム中は変更できません');
  }

  dispatch(player, msg) {
    switch (msg.t) {
      case 'rename':
        player.name = cleanName(msg.name);
        break;

      case 'setGame':
        this.requireHost(player);
        this.requireLobby();
        if (!Object.hasOwn(GAMES, msg.gameId)) throw new RoomError('そのゲームはありません');
        this.gameId = msg.gameId;
        break;

      case 'addBot': {
        this.requireHost(player);
        this.requireLobby();
        if (this.activePlayers().length >= MAX_PLAYERS) throw new RoomError('これ以上は追加できません');
        if (this.players.length >= MAX_MEMBERS) throw new RoomError('このルームは満員です');
        this.botCount++;
        this.players.push({
          id: randomBytes(6).toString('base64url'),
          clientId: null,
          name: `CPU ${this.botCount}`,
          color: this.freeColor(),
          bot: true,
          spectator: false,
          conn: null,
        });
        break;
      }

      case 'kick': {
        this.requireHost(player);
        const target = this.players.find((p) => p.id === msg.playerId);
        if (!target || target === player) throw new RoomError('そのプレイヤーは外せません');
        if (this.isSeated(target)) throw new RoomError('対戦中のプレイヤーは外せません');
        this.removePlayer(target);
        const conn = target.conn;
        target.conn = null;
        conn?.close(CLOSE_KICKED, 'kicked');
        break;
      }

      case 'setSpectator': {
        if (this.phase === 'playing') throw new RoomError('ゲーム中は変更できません');
        const want = !!msg.value;
        if (want === player.spectator) break;
        if (want) {
          player.spectator = true;
          player.color = -1;
        } else {
          if (this.activePlayers().length >= MAX_PLAYERS) throw new RoomError('プレイヤーの席がいっぱいです');
          player.spectator = false;
          player.color = this.freeColor();
        }
        break;
      }

      case 'start':
      case 'rematch':
        this.requireHost(player);
        if (msg.t === 'start') this.requireLobby();
        else if (!this.game) throw new RoomError('まだゲームが始まっていません');
        this.startGame();
        break;

      case 'toLobby':
        this.requireHost(player);
        this.endGame();
        break;

      case 'action': {
        if (this.phase !== 'playing' || !this.game) throw new RoomError('いまは操作できません');
        const seat = this.game.seats.indexOf(player.id);
        if (seat < 0) throw new RoomError('観戦中は操作できません');
        this.applyAction(seat, msg.action);
        break;
      }

      case 'cpuMove': {
        // 席を外している人の番を、ホストが CPU に1手だけ進めてもらう。
        this.requireHost(player);
        if (this.phase !== 'playing' || !this.game) throw new RoomError('いまは操作できません');
        const seat = this.game.seats.indexOf(msg.playerId);
        const game = GAMES[this.game.id];
        if (seat < 0 || !game.pending(this.game.state).includes(seat)) {
          throw new RoomError('その人はいま行動待ちではありません');
        }
        this.applyAction(seat, game.bot(this.game.state, seat, this.manager.rng));
        break;
      }

      case 'takeover': {
        // 観戦者が、切断したままの人の席を引き継ぐ (端末を変えたときなど)。
        if (!player.spectator) throw new RoomError('観戦中の人だけが引き継げます');
        const target = this.players.find((p) => p.id === msg.playerId);
        if (!target || target.bot || target.conn || !this.isSeated(target)) {
          throw new RoomError('その席は引き継げません');
        }
        const conn = player.conn;
        this.removePlayer(player);
        target.clientId = player.clientId;
        target.name = player.name;
        target.conn = conn;
        target.leftAt = null;
        conn.rebind?.(target);
        if (this.hostId === player.id) this.hostId = target.id;
        break;
      }

      case 'emote':
        if (!EMOTES.includes(msg.emoji)) break;
        this.send({ t: 'emote', playerId: player.id, emoji: msg.emoji });
        return;

      default:
        throw new RoomError('不明な操作です');
    }
    this.broadcast();
  }

  // ---- ゲーム進行 -------------------------------------------------------

  startGame() {
    const game = GAMES[this.gameId];
    // 再戦のときは同じ顔ぶれで。切断したまま戻ってこない人の席は詰める。
    const seats = this.activePlayers()
      .filter((p) => !this.isGhost(p))
      .map((p) => p.id);
    const { minPlayers, maxPlayers, name } = game.meta;
    if (seats.length < minPlayers) {
      throw new RoomError(`「${name}」は${minPlayers}人から遊べます。CPU を追加することもできます`);
    }
    if (seats.length > maxPlayers) {
      throw new RoomError(`「${name}」は${maxPlayers}人までです。だれかが観戦にまわってください`);
    }
    // 席順は毎回シャッフルして、いつも同じ人の隣にならないようにする。
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(this.manager.rng() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    clearTimeout(this.botTimer);
    this.botTimer = null;
    this.stopTick();
    this.phase = 'lobby';
    this.prune();
    this.game = {
      id: this.gameId,
      no: ++this.gameCount, // 何戦目か。画面側が再戦を見分けるのに使う
      seats,
      state: game.setup({ n: seats.length, rng: this.manager.rng }),
      since: this.manager.now(),
    };
    this.phase = 'playing';
    this.scheduleBots();
    this.scheduleTick();
  }

  endGame() {
    clearTimeout(this.botTimer);
    this.botTimer = null;
    this.stopTick();
    this.game = null;
    this.phase = 'lobby';
    this.prune();
  }

  applyAction(seat, action) {
    const game = GAMES[this.game.id];
    game.act(this.game.state, seat, action, this.manager.rng);
    this.afterChange();
  }

  /** 状態が変わったあとの後始末 (終了の判定、CPU と時計の予約)。 */
  afterChange() {
    this.game.since = this.manager.now();
    if (this.game.state.over) {
      this.phase = 'finished';
      clearTimeout(this.botTimer);
      this.botTimer = null;
      this.stopTick();
    } else {
      this.scheduleBots();
      this.scheduleTick();
    }
  }

  /**
   * 時間で進むゲーム (競りの値下がりなど) のための時計。
   * ゲームが timer(state) で { ms, key } を返すと、ms 後に tick(state) を呼ぶ。
   * key が同じあいだは予約し直さないので、関係ない操作で時計が延びることはない。
   */
  scheduleTick() {
    if (this.phase !== 'playing' || !this.game) return;
    const game = GAMES[this.game.id];
    const wanted = game.timer?.(this.game.state) ?? null;
    if (!wanted || !this.hasConnectedHuman()) {
      this.stopTick();
      return;
    }
    if (this.tickTimer && this.tickKey === wanted.key) return;
    this.stopTick();
    this.tickKey = wanted.key;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.tickKey = null;
      if (this.phase !== 'playing' || !this.game) return;
      try {
        game.tick(this.game.state, this.manager.rng);
      } catch (err) {
        console.error(`[room ${this.code}] tick failed`, err);
        return;
      }
      this.afterChange();
      this.broadcast();
    }, wanted.ms);
    this.tickTimer.unref?.();
  }

  stopTick() {
    clearTimeout(this.tickTimer);
    this.tickTimer = null;
    this.tickKey = null;
  }

  /** CPU の席に行動待ちがあれば、少し間をおいて1手ずつ進める。 */
  scheduleBots() {
    if (this.botTimer || this.phase !== 'playing') return;
    if (!this.nextBotMove()) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.phase !== 'playing' || !this.game) return;
      const move = this.nextBotMove();
      if (!move) return;
      try {
        this.applyAction(move.seat, move.action);
      } catch (err) {
        console.error(`[room ${this.code}] bot failed`, err);
        return;
      }
      this.broadcast();
    }, this.manager.botDelay() * (GAMES[this.game.id].meta.realtime ? 0.5 : 1));
    this.botTimer.unref?.();
  }

  nextBotMove() {
    const game = GAMES[this.game.id];
    const seated = this.game.seats.map((id) => this.players.find((p) => p.id === id));
    // 「次へ」は結果を読み終えた人間が押すもの。ただし席に人間がだれもいなければ CPU が進める。
    const humanSeated = seated.some((p) => p && !p.bot && p.conn);
    // リアルタイムのゲームには「番」がないので、CPU 全員に動くかどうかを聞く。
    let seats = game.pending(this.game.state);
    if (game.meta.realtime) {
      seats = seated.map((_, seat) => seat).sort(() => this.manager.rng() - 0.5);
    }
    for (const seat of seats) {
      if (!seated[seat]?.bot) continue;
      const action = game.bot(this.game.state, seat, this.manager.rng);
      if (!action || (action.type === 'next' && humanSeated)) continue;
      return { seat, action };
    }
    return null;
  }

  // ---- 配信 -------------------------------------------------------------

  publicState() {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      gameId: this.gameId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        bot: p.bot,
        spectator: p.spectator,
        connected: p.bot || !!p.conn,
      })),
    };
  }

  send(msg) {
    for (const p of this.players) p.conn?.send(msg);
  }

  broadcast() {
    const room = this.publicState();
    const game = this.game ? GAMES[this.game.id] : null;
    const pending = game ? game.pending(this.game.state) : [];
    for (const p of this.players) {
      if (!p.conn) continue;
      let gameMsg = null;
      if (game) {
        const seat = this.game.seats.indexOf(p.id);
        gameMsg = {
          id: this.game.id,
          no: this.game.no,
          seats: this.game.seats,
          seat,
          pending,
          since: this.game.since,
          view: game.view(this.game.state, seat),
        };
      }
      p.conn.send({ t: 'state', you: p.id, clientId: p.clientId, room, game: gameMsg, now: this.manager.now() });
    }
  }
}
