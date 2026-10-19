/**
 * fastEngine.ts — Highly optimized 0x88 chess search engine.
 *
 * Runs inside a Web Worker so the UI thread never freezes.
 * Key optimisations vs. the classic engine:
 *   • 0x88 board representation (fast off-board detection, no bounds math)
 *   • Make/Unmake instead of cloning the board for every candidate move
 *   • Transposition table (2^20 entries, typed arrays, zero allocation)
 *   • Quiescence search (no horizon blunders on captures)
 *   • MVV-LVA move ordering + killer moves + history heuristic
 *   • Iterative deepening with a hard wall-clock budget
 *   • O(1) pawn-structure evaluation (no nested board scans)
 */

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const WHITE = 0;
export const BLACK = 1;

export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

const FLAG_EP = 1;
const FLAG_CASTLE_K = 2;
const FLAG_CASTLE_Q = 3;
const FLAG_DOUBLE = 4;

const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33];
const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17];
const BISHOP_OFFSETS = [-17, -15, 15, 17];
const ROOK_OFFSETS = [-16, -1, 1, 16];

const PIECE_VALS = [0, 100, 320, 330, 500, 900, 20000];

/* ─────────────────────────── Zobrist hashing ─────────────────────────── */

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x9e3779b9);
const ZOB_PIECE: number[][] = [];
const ZOB_SIDE = (rand() * 4294967296) | 0;
const ZOB_CASTLE: number[] = [];
const ZOB_EP: number[] = [];
for (let p = 0; p < 13; p++) {
  ZOB_PIECE[p] = [];
  for (let s = 0; s < 128; s++) ZOB_PIECE[p][s] = (rand() * 4294967296) | 0;
}
for (let c = 0; c < 16; c++) ZOB_CASTLE[c] = (rand() * 4294967296) | 0;
for (let s = 0; s < 128; s++) ZOB_EP[s] = (rand() * 4294967296) | 0;

const zobPiece = (piece: number, sq: number) => ZOB_PIECE[piece + 6][sq];

/* ─────────────────── Piece-square tables (mirrors the main engine) ─────────────────── */

const PST_PAWN = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 25, 25, 10, 5, 5],
  [0, 0, 0, 20, 20, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -20, -20, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const PST_KNIGHT = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 10, 15, 15, 10, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30],
  [-30, 0, 15, 20, 20, 15, 0, -30],
  [-30, 5, 10, 15, 15, 10, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];
const PST_BISHOP = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 5, 0, 0, 0, 0, 5, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];
const PST_ROOK = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 10, 10, 10, 10, 10, 10, 5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 0, 5, 5, 0, 0, 0],
];
const PST_QUEEN = [
  [-20, -10, -10, -5, -5, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 5, 5, 5, 0, -10],
  [-5, 0, 5, 5, 5, 5, 0, -5],
  [0, 0, 5, 5, 5, 5, 0, -5],
  [-10, 5, 5, 5, 5, 5, 0, -10],
  [-10, 0, 5, 0, 0, 0, 0, -10],
  [-20, -10, -10, -5, -5, -10, -10, -20],
];
const PST_KING = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20],
];

const PSTS: number[][][] = [
  [],
  PST_PAWN,
  PST_KNIGHT,
  PST_BISHOP,
  PST_ROOK,
  PST_QUEEN,
  PST_KING,
];

/* ─────────────────────────── Position ─────────────────────────── */

export interface Pos {
  board: Int8Array;
  turn: number;
  castling: number;
  ep: number;
  kings: Int32Array;
  hash: number;
}

export function sqToName(sq: number): string {
  return 'abcdefgh'[sq & 7] + String(8 - (sq >> 4));
}
export function nameToSq(name: string): number {
  return (8 - parseInt(name[1], 10)) * 16 + (name.charCodeAt(0) - 97);
}

export function clonePos(p: Pos): Pos {
  return {
    board: p.board.slice(),
    turn: p.turn,
    castling: p.castling,
    ep: p.ep,
    kings: p.kings.slice(),
    hash: p.hash,
  };
}

export function computeHash(p: Pos): number {
  let h = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = p.board[sq];
    if (piece) h ^= zobPiece(piece, sq);
  }
  if (p.turn === BLACK) h ^= ZOB_SIDE;
  h ^= ZOB_CASTLE[p.castling & 15];
  if (p.ep >= 0) h ^= ZOB_EP[p.ep];
  return h | 0;
}

/* ─────────────────────────── Move encoding ─────────────────────────── */
// bits 0-7  : from square
// bits 8-15 : to square
// bits 16-18: promotion (0 none, 1 Q, 2 R, 3 B, 4 N)
// bits 19-22: captured piece encoded (value + 7); 0 = none
// bits 23-25: flags

export function encodeMove(
  from: number,
  to: number,
  promo: number,
  captured: number,
  flags: number
): number {
  // captured: 0 = none, otherwise the signed piece value (-6..6)
  const capturedField = captured === 0 ? 0 : captured + 7;
  return (
    ((from & 0xff) |
      ((to & 0xff) << 8) |
      ((promo & 7) << 16) |
      ((capturedField & 15) << 19) |
      ((flags & 7) << 23)) >>>
    0
  );
}

export const moveFrom = (m: number) => m & 0xff;
export const moveTo = (m: number) => (m >> 8) & 0xff;
export const movePromo = (m: number) => (m >> 16) & 7;
export const moveFlags = (m: number) => (m >> 23) & 7;
export const moveCaptured = (m: number) => {
  const f = (m >> 19) & 15;
  return f === 0 ? 0 : f - 7;
};

/* ─────────────────────────── Attack detection ─────────────────────────── */

export function isSquareAttacked(
  board: Int8Array,
  sq: number,
  byWhite: boolean
): boolean {
  if (byWhite) {
    const a = sq + 15;
    const b = sq + 17;
    if (a < 128 && !(a & 0x88) && board[a] === PAWN) return true;
    if (b < 128 && !(b & 0x88) && board[b] === PAWN) return true;
  } else {
    const a = sq - 15;
    const b = sq - 17;
    if (a >= 0 && !(a & 0x88) && board[a] === -PAWN) return true;
    if (b >= 0 && !(b & 0x88) && board[b] === -PAWN) return true;
  }

  const knight = byWhite ? KNIGHT : -KNIGHT;
  for (let i = 0; i < 8; i++) {
    const t = sq + KNIGHT_OFFSETS[i];
    if (t >= 0 && t < 128 && !(t & 0x88) && board[t] === knight) return true;
  }

  const king = byWhite ? KING : -KING;
  for (let i = 0; i < 8; i++) {
    const t = sq + KING_OFFSETS[i];
    if (t >= 0 && t < 128 && !(t & 0x88) && board[t] === king) return true;
  }

  for (let i = 0; i < 4; i++) {
    const off = ROOK_OFFSETS[i];
    let t = sq + off;
    while (t >= 0 && t < 128 && !(t & 0x88)) {
      const piece = board[t];
      if (piece) {
        if (byWhite) {
          if (piece === ROOK || piece === QUEEN) return true;
        } else if (piece === -ROOK || piece === -QUEEN) return true;
        break;
      }
      t += off;
    }
  }

  for (let i = 0; i < 4; i++) {
    const off = BISHOP_OFFSETS[i];
    let t = sq + off;
    while (t >= 0 && t < 128 && !(t & 0x88)) {
      const piece = board[t];
      if (piece) {
        if (byWhite) {
          if (piece === BISHOP || piece === QUEEN) return true;
        } else if (piece === -BISHOP || piece === -QUEEN) return true;
        break;
      }
      t += off;
    }
  }

  return false;
}

/* ─────────────────────────── Move generation ─────────────────────────── */

function addPawnMoves(
  p: Pos,
  sq: number,
  white: boolean,
  capturesOnly: boolean,
  out: number[]
) {
  const board = p.board;
  const dir = white ? -16 : 16;
  const startRow = white ? 6 : 1; // rank 2 for white, rank 7 for black
  const promoRow = white ? 0 : 7; // rank 8 for white, rank 1 for black
  const enemyKingSq = p.kings[white ? BLACK : WHITE];

  const push = (to: number, flags = 0) => {
    if (to < 0 || to > 127 || to & 0x88) return;
    if (board[to] !== EMPTY) return;
    if ((to >> 4) === promoRow) {
      out.push(encodeMove(sq, to, 1, 0, flags));
      out.push(encodeMove(sq, to, 2, 0, flags));
      out.push(encodeMove(sq, to, 3, 0, flags));
      out.push(encodeMove(sq, to, 4, 0, flags));
    } else {
      out.push(encodeMove(sq, to, 0, 0, flags));
    }
  };

  const capture = (to: number) => {
    if (to < 0 || to > 127 || to & 0x88) return;
    const target = board[to];
    if (target === EMPTY) return;
    if (target > 0 === white) return;
    if (to === enemyKingSq) return;
    if ((to >> 4) === promoRow) {
      out.push(encodeMove(sq, to, 1, target, 0));
      out.push(encodeMove(sq, to, 2, target, 0));
      out.push(encodeMove(sq, to, 3, target, 0));
      out.push(encodeMove(sq, to, 4, target, 0));
    } else {
      out.push(encodeMove(sq, to, 0, target, 0));
    }
  };

  if (!capturesOnly) {
    push(sq + dir);
    if ((sq >> 4) === startRow) {
      const mid = sq + dir;
      if (mid >= 0 && mid < 128 && !(mid & 0x88) && board[mid] === EMPTY) {
        push(sq + dir * 2, FLAG_DOUBLE);
      }
    }
  }

  capture(sq + dir - 1);
  capture(sq + dir + 1);

  if (p.ep >= 0 && !capturesOnly) {
    const to = p.ep;
    if (to === sq + dir - 1 || to === sq + dir + 1) {
      const capSq = white ? to + 16 : to - 16;
      const capPiece = board[capSq];
      if (capPiece === (white ? -PAWN : PAWN)) {
        out.push(encodeMove(sq, to, 0, capPiece, FLAG_EP));
      }
    }
  }
}

function addKnightMoves(
  p: Pos,
  sq: number,
  white: boolean,
  capturesOnly: boolean,
  out: number[]
) {
  const board = p.board;
  const enemyKingSq = p.kings[white ? BLACK : WHITE];
  for (let i = 0; i < 8; i++) {
    const to = sq + KNIGHT_OFFSETS[i];
    if (to < 0 || to > 127 || to & 0x88) continue;
    const target = board[to];
    if (target === EMPTY) {
      if (!capturesOnly) out.push(encodeMove(sq, to, 0, 0, 0));
    } else {
      if (target > 0 === white) continue;
      if (to === enemyKingSq) continue;
      out.push(encodeMove(sq, to, 0, target, 0));
    }
  }
}

function addKingMoves(
  p: Pos,
  sq: number,
  white: boolean,
  capturesOnly: boolean,
  out: number[]
) {
  const board = p.board;
  const enemyKingSq = p.kings[white ? BLACK : WHITE];
  for (let i = 0; i < 8; i++) {
    const to = sq + KING_OFFSETS[i];
    if (to < 0 || to > 127 || to & 0x88) continue;
    const target = board[to];
    if (target === EMPTY) {
      if (!capturesOnly) out.push(encodeMove(sq, to, 0, 0, 0));
    } else {
      if (target > 0 === white) continue;
      if (to === enemyKingSq) continue;
      out.push(encodeMove(sq, to, 0, target, 0));
    }
  }
}

function addSliding(
  p: Pos,
  sq: number,
  white: boolean,
  offsets: number[],
  capturesOnly: boolean,
  out: number[]
) {
  const board = p.board;
  const enemyKingSq = p.kings[white ? BLACK : WHITE];
  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[i];
    let to = sq + off;
    while (to >= 0 && to < 128 && !(to & 0x88)) {
      const target = board[to];
      if (target === EMPTY) {
        if (!capturesOnly) out.push(encodeMove(sq, to, 0, 0, 0));
      } else {
        if (target > 0 === white) break;
        if (to === enemyKingSq) break;
        out.push(encodeMove(sq, to, 0, target, 0));
        break;
      }
      to += off;
    }
  }
}

function addCastling(p: Pos, sq: number, white: boolean, out: number[]) {
  const board = p.board;
  const backRank = white ? 7 : 0;
  if ((sq >> 4) !== backRank) return;

  const rightK = white ? CASTLE_WK : CASTLE_BK;
  const rightQ = white ? CASTLE_WQ : CASTLE_BQ;

  if (p.castling & rightK) {
    const f = sq + 1;
    const g = sq + 2;
    const h = sq + 3;
    if (
      board[f] === EMPTY &&
      board[g] === EMPTY &&
      board[h] === ROOK * (white ? 1 : -1) &&
      !isSquareAttacked(board, sq, !white) &&
      !isSquareAttacked(board, f, !white) &&
      !isSquareAttacked(board, g, !white)
    ) {
      out.push(encodeMove(sq, g, 0, 0, FLAG_CASTLE_K));
    }
  }

  if (p.castling & rightQ) {
    const d = sq - 1;
    const c = sq - 2;
    const b = sq - 3;
    const a = sq - 4; // a-rook is four files from the king (e1 -> d1 -> c1 -> b1 -> a1)
    if (
      board[d] === EMPTY &&
      board[c] === EMPTY &&
      board[b] === EMPTY &&
      board[a] === ROOK * (white ? 1 : -1) &&
      !isSquareAttacked(board, sq, !white) &&
      !isSquareAttacked(board, d, !white) &&
      !isSquareAttacked(board, c, !white)
    ) {
      out.push(encodeMove(sq, c, 0, 0, FLAG_CASTLE_Q));
    }
  }
}

export function generateMoves(
  p: Pos,
  color: number,
  capturesOnly = false
): number[] {
  const out: number[] = [];
  const board = p.board;
  const white = color === WHITE;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board[sq];
    if (piece === EMPTY) continue;
    if (piece > 0 !== white) continue;
    const type = piece > 0 ? piece : -piece;

    switch (type) {
      case PAWN:
        addPawnMoves(p, sq, white, capturesOnly, out);
        break;
      case KNIGHT:
        addKnightMoves(p, sq, white, capturesOnly, out);
        break;
      case BISHOP:
        addSliding(p, sq, white, BISHOP_OFFSETS, capturesOnly, out);
        break;
      case ROOK:
        addSliding(p, sq, white, ROOK_OFFSETS, capturesOnly, out);
        break;
      case QUEEN:
        addSliding(p, sq, white, KING_OFFSETS, capturesOnly, out);
        break;
      case KING:
        addKingMoves(p, sq, white, capturesOnly, out);
        if (!capturesOnly) addCastling(p, sq, white, out);
        break;
    }
  }

  return out;
}

/* ─────────────────────────── Make / Unmake ─────────────────────────── */

const MAX_STACK = 4096;
const uMove = new Int32Array(MAX_STACK);
const uPiece = new Int8Array(MAX_STACK);
const uCap = new Int8Array(MAX_STACK);
const uCapSq = new Int8Array(MAX_STACK);
const uCastle = new Int8Array(MAX_STACK);
const uEp = new Int16Array(MAX_STACK);
const uTurn = new Int8Array(MAX_STACK);
const uKingW = new Int32Array(MAX_STACK);
const uKingB = new Int32Array(MAX_STACK);
const uHash = new Int32Array(MAX_STACK);
let stackPtr = 0;

export function makeMove(p: Pos, move: number): void {
  const from = move & 0xff;
  const to = (move >> 8) & 0xff;
  const promo = (move >> 16) & 7;
  const flags = (move >> 23) & 7;
  const board = p.board;
  const piece = board[from];
  const white = piece > 0;

  // Save undo state
  uMove[stackPtr] = move;
  uPiece[stackPtr] = piece;
  uCastle[stackPtr] = p.castling;
  uEp[stackPtr] = p.ep;
  uTurn[stackPtr] = p.turn;
  uKingW[stackPtr] = p.kings[WHITE];
  uKingB[stackPtr] = p.kings[BLACK];
  uHash[stackPtr] = p.hash;

  let hash = p.hash;
  hash ^= zobPiece(piece, from);

  // Determine captured piece
  let captured = 0;
  let capSq = -1;
  if (flags === FLAG_EP) {
    capSq = white ? to + 16 : to - 16;
    captured = board[capSq];
  } else {
    const target = board[to];
    if (target !== EMPTY) {
      captured = target;
      capSq = to;
    }
  }
  uCap[stackPtr] = captured;
  uCapSq[stackPtr] = capSq;

  if (capSq >= 0) {
    hash ^= zobPiece(captured, capSq);
    board[capSq] = EMPTY;
  }

  board[from] = EMPTY;
  let placed = piece;
  if (promo) {
    const promoCode = promo === 1 ? QUEEN : promo === 2 ? ROOK : promo === 3 ? BISHOP : KNIGHT;
    placed = promoCode * (white ? 1 : -1);
  }
  board[to] = placed;
  hash ^= zobPiece(placed, to);

  if (flags === FLAG_CASTLE_K) {
    const rookFrom = to + 1;
    const rookTo = to - 1;
    const rook = board[rookFrom];
    board[rookFrom] = EMPTY;
    board[rookTo] = rook;
    hash ^= zobPiece(rook, rookFrom) ^ zobPiece(rook, rookTo);
  } else if (flags === FLAG_CASTLE_Q) {
    const rookFrom = to - 2;
    const rookTo = to + 1;
    const rook = board[rookFrom];
    board[rookFrom] = EMPTY;
    board[rookTo] = rook;
    hash ^= zobPiece(rook, rookFrom) ^ zobPiece(rook, rookTo);
  }

  let castling = p.castling;
  if (piece === KING || piece === -KING) {
    castling &= white ? ~(CASTLE_WK | CASTLE_WQ) : ~(CASTLE_BK | CASTLE_BQ);
    p.kings[white ? WHITE : BLACK] = to;
  } else {
    if (from === 119) castling &= ~CASTLE_WK;
    if (from === 112) castling &= ~CASTLE_WQ;
    if (from === 7) castling &= ~CASTLE_BK;
    if (from === 0) castling &= ~CASTLE_BQ;
  }

  const newEp = flags === FLAG_DOUBLE ? (from + to) >> 1 : -1;

  hash ^= ZOB_CASTLE[p.castling & 15];
  hash ^= ZOB_CASTLE[castling & 15];
  if (p.ep >= 0) hash ^= ZOB_EP[p.ep];
  if (newEp >= 0) hash ^= ZOB_EP[newEp];
  hash ^= ZOB_SIDE;

  p.castling = castling;
  p.ep = newEp;
  p.turn = p.turn === WHITE ? BLACK : WHITE;
  p.hash = hash | 0;

  stackPtr++;
}

export function unmakeMove(p: Pos): void {
  stackPtr--;
  const sp = stackPtr;
  const move = uMove[sp];
  const from = move & 0xff;
  const to = (move >> 8) & 0xff;
  const flags = (move >> 23) & 7;
  const board = p.board;

  if (flags === FLAG_CASTLE_K) {
    const rookFrom = to + 1;
    const rookTo = to - 1;
    board[rookFrom] = board[rookTo];
    board[rookTo] = EMPTY;
  } else if (flags === FLAG_CASTLE_Q) {
    const rookFrom = to - 2;
    const rookTo = to + 1;
    board[rookFrom] = board[rookTo];
    board[rookTo] = EMPTY;
  }

  board[to] = EMPTY;

  const capSq = uCapSq[sp];
  if (capSq >= 0) board[capSq] = uCap[sp];

  board[from] = uPiece[sp];

  p.castling = uCastle[sp];
  p.ep = uEp[sp];
  p.turn = uTurn[sp];
  p.kings[WHITE] = uKingW[sp];
  p.kings[BLACK] = uKingB[sp];
  p.hash = uHash[sp];
}

/* ─────────────────────────── Evaluation (O(64) per leaf) ─────────────────────────── */

const PASSED_BONUS = [0, 6, 14, 28, 50, 82, 130, 0];

// Scratch arrays reused between evaluations (zero allocation)
const wPawnCount = new Int32Array(8);
const bPawnCount = new Int32Array(8);
const wPawnMinRow = new Int32Array(8);
const bPawnMinRow = new Int32Array(8);
const wPawnMaxRow = new Int32Array(8);
const bPawnMaxRow = new Int32Array(8);
const pawnSqList = new Int32Array(16);
const pawnIsWhite = new Uint8Array(16);

function evaluate(p: Pos, side: number): number {
  const board = p.board;
  const sign = side === WHITE ? 1 : -1;
  let score = 0;

  wPawnCount.fill(0);
  bPawnCount.fill(0);
  wPawnMinRow.fill(99);
  bPawnMinRow.fill(99);
  wPawnMaxRow.fill(-1);
  bPawnMaxRow.fill(-1);
  let pawnListLen = 0;
  let wBishops = 0;
  let bBishops = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board[sq];
    if (piece === EMPTY) continue;
    const white = piece > 0;
    const type = piece > 0 ? piece : -piece;
    const row = sq >> 4;
    const col = sq & 7;
    const pstRow = white ? row : 7 - row;

    let v = PIECE_VALS[type] + PSTS[type][pstRow][col];

    if (type === PAWN) {
      if (white) {
        wPawnCount[col]++;
        if (row < wPawnMinRow[col]) wPawnMinRow[col] = row;
        if (row > wPawnMaxRow[col]) wPawnMaxRow[col] = row;
      } else {
        bPawnCount[col]++;
        if (row < bPawnMinRow[col]) bPawnMinRow[col] = row;
        if (row > bPawnMaxRow[col]) bPawnMaxRow[col] = row;
      }
      if (pawnListLen < 16) {
        pawnSqList[pawnListLen] = sq;
        pawnIsWhite[pawnListLen] = white ? 1 : 0;
        pawnListLen++;
      }
    } else if (type === BISHOP) {
      if (white) wBishops++;
      else bBishops++;
    }

    score += white ? v : -v;
  }

  if (wBishops >= 2) score += 30;
  if (bBishops >= 2) score -= 30;

  // Pawn structure
  for (let i = 0; i < pawnListLen; i++) {
    const sq = pawnSqList[i];
    const white = pawnIsWhite[i] === 1;
    const col = sq & 7;
    const row = sq >> 4;

    const ownCount = white ? wPawnCount[col] : bPawnCount[col];
    if (ownCount > 1) score += white ? -16 : 16; // doubled

    // Isolated: no friendly pawn on neighbouring files
    let isolated = true;
    for (let df = -1; df <= 1; df += 2) {
      const c2 = col + df;
      if (c2 < 0 || c2 > 7) continue;
      const n = white ? wPawnCount[c2] : bPawnCount[c2];
      if (n > 0) {
        isolated = false;
        break;
      }
    }
    if (isolated) score += white ? -13 : 13;

    // Passed: no enemy pawn able to stop it on adjacent files
    let passed = true;
    for (let df = -1; df <= 1; df += 2) {
      const c2 = col + df;
      if (c2 < 0 || c2 > 7) continue;
      if (white) {
        // Black pawn ahead of white pawn ⇒ black row < white row
        if (bPawnCount[c2] > 0 && bPawnMinRow[c2] < row) {
          passed = false;
          break;
        }
      } else {
        // White pawn ahead of black pawn ⇒ white row > black row
        if (wPawnCount[c2] > 0 && wPawnMaxRow[c2] > row) {
          passed = false;
          break;
        }
      }
    }
    if (passed) {
      const advance = white ? 7 - row : row;
      score += (white ? 1 : -1) * PASSED_BONUS[advance];
    }
  }

  // Rooks on open / semi-open files
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = board[sq];
    if (piece !== ROOK && piece !== -ROOK) continue;
    const col = sq & 7;
    const white = piece > 0;
    if (wPawnCount[col] === 0 && bPawnCount[col] === 0) {
      score += white ? 18 : -18;
    } else if (white ? wPawnCount[col] > 0 && bPawnCount[col] === 0 : bPawnCount[col] > 0 && wPawnCount[col] === 0) {
      score += white ? 8 : -8;
    }
  }

  return score * sign;
}

/* ─────────────────────────── Transposition table ─────────────────────────── */

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttKey = new Int32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttScore = new Int32Array(TT_SIZE);
const ttFlag = new Int8Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE);
const ttUsed = new Uint8Array(TT_SIZE);

/* ─────────────────────────── Search ─────────────────────────── */

const MATE = 100000;
const INF = 1e9;

let deadline = 0;
let nodeCount = 0;
let aborted = false;

const killerMoves = new Int32Array(128);
const historyTable = new Int32Array(128 * 128);
const scoreBuf = new Int32Array(256);
const moveBuf = new Int32Array(256);

function timeUp(): boolean {
  if (aborted) return true;
  if ((nodeCount & 255) === 0 && Date.now() > deadline) {
    aborted = true;
    return true;
  }
  return false;
}

function scoreMove(p: Pos, move: number, ply: number): number {
  const from = move & 0xff;
  const to = (move >> 8) & 0xff;
  const capturedField = (move >> 19) & 15;
  const flags = (move >> 23) & 7;

  if (flags === FLAG_EP) return 1_000_000;
  if (capturedField !== 0) {
    const victim = capturedField - 7;
    const attacker = Math.abs(p.board[from]);
    return 900_000 + Math.abs(victim) * 16 - attacker;
  }
  if (ply < 64) {
    if (move === killerMoves[ply * 2]) return 800_000;
    if (move === killerMoves[ply * 2 + 1]) return 790_000;
  }
  return historyTable[from * 128 + to];
}

function orderMoves(p: Pos, moves: number[], ply: number): void {
  const n = moves.length;
  if (n === 0) return;
  for (let i = 0; i < n; i++) {
    moveBuf[i] = moves[i];
    scoreBuf[i] = scoreMove(p, moves[i], ply);
  }
  // insertion sort on parallel arrays (small n, very fast in practice)
  for (let i = 1; i < n; i++) {
    const m = moveBuf[i];
    const s = scoreBuf[i];
    let j = i - 1;
    while (j >= 0 && scoreBuf[j] < s) {
      moveBuf[j + 1] = moveBuf[j];
      scoreBuf[j + 1] = scoreBuf[j];
      j--;
    }
    moveBuf[j + 1] = m;
    scoreBuf[j + 1] = s;
  }
  for (let i = 0; i < n; i++) moves[i] = moveBuf[i];
}

function quiescence(p: Pos, alpha: number, beta: number, ply: number): number {
  nodeCount++;
  if (timeUp()) return 0;

  const side = p.turn;
  const stand = evaluate(p, side);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  const moves = generateMoves(p, side, true);
  orderMoves(p, moves, ply);

  const attackerIsWhite = side === BLACK;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    makeMove(p, move);
    if (isSquareAttacked(p.board, p.kings[side], attackerIsWhite)) {
      unmakeMove(p);
      continue;
    }
    const score = -quiescence(p, -beta, -alpha, ply + 1);
    unmakeMove(p);
    if (aborted) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(p: Pos, depth: number, alpha: number, beta: number, ply: number): number {
  if (timeUp()) return 0;
  nodeCount++;

  const side = p.turn;
  const moverKingSq = p.kings[side];
  const inCheck = isSquareAttacked(p.board, moverKingSq, side === BLACK);

  if (inCheck) depth++;

  if (depth <= 0) return quiescence(p, alpha, beta, ply);

  if (ply > 0) {
    if (alpha < -MATE + ply) alpha = -MATE + ply;
    if (beta > MATE - ply - 1) beta = MATE - ply - 1;
    if (alpha >= beta) return alpha;
  }

  const alphaOrig = alpha;
  const key = p.hash;
  const ttIndex = key & TT_MASK;
  let ttBest = 0;

  if (ttUsed[ttIndex] && ttKey[ttIndex] === key) {
    ttBest = ttMove[ttIndex];
    if (ttDepth[ttIndex] >= depth) {
      const s = ttScore[ttIndex];
      const flag = ttFlag[ttIndex];
      if (flag === 0) return s;
      if (flag === 1 && s > alpha) alpha = s;
      else if (flag === 2 && s < beta) beta = s;
      if (alpha >= beta) return s;
    }
  }

  const moves = generateMoves(p, side, false);
  if (moves.length === 0) {
    return inCheck ? -MATE + ply : 0;
  }
  if (ttBest) {
    // move to front
    const idx = moves.indexOf(ttBest);
    if (idx > 0) {
      moves.splice(idx, 1);
      moves.unshift(ttBest);
    }
  }
  orderMoves(p, moves, ply);

  let best = -INF;
  let bestMove = 0;
  let legalCount = 0;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    makeMove(p, move);
    if (isSquareAttacked(p.board, moverKingSq, side === BLACK)) {
      unmakeMove(p);
      continue;
    }
    legalCount++;

    let score: number;
    if (legalCount === 1) {
      score = -negamax(p, depth - 1, -beta, -alpha, ply + 1);
    } else {
      const isCapture = ((move >> 19) & 15) !== 0;
      if (depth >= 3 && legalCount > 4 && !isCapture && !inCheck) {
        score = -negamax(p, depth - 2, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && score < beta) {
          score = -negamax(p, depth - 1, -beta, -alpha, ply + 1);
        }
      } else {
        score = -negamax(p, depth - 1, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && score < beta) {
          score = -negamax(p, depth - 1, -beta, -alpha, ply + 1);
        }
      }
    }

    unmakeMove(p);
    if (aborted) return 0;

    if (score > best) {
      best = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      if (((move >> 19) & 15) === 0 && ply < 64) {
        killerMoves[ply * 2] = move;
        historyTable[(move & 0xff) * 128 + ((move >> 8) & 0xff)] += depth * depth;
      }
      break;
    }
  }

  if (legalCount > 0) {
    const idx = p.hash & TT_MASK;
    // Never let ±INF leak into the table — a stored infinity would be
    // returned to a parent node and invert into an absurd score.
    const clamped = best <= -MATE + 2 ? -MATE + 2 : best >= MATE - 2 ? MATE - 2 : best;
    ttUsed[idx] = 1;
    ttKey[idx] = p.hash;
    ttDepth[idx] = Math.min(depth, 120);
    ttScore[idx] = clamped;
    ttFlag[idx] = best <= alphaOrig ? 2 : best >= beta ? 1 : 0;
    ttMove[idx] = bestMove;
  }

  return best <= -MATE + 2 ? -MATE + 2 : best >= MATE - 2 ? MATE - 2 : best;
}

/* ─────────────────────────── Public search API ─────────────────────────── */

export interface SearchOutcome {
  move: number | null;
  score: number;
  scores: Record<string, number>;
  depth: number;
  nodes: number;
  ms: number;
}

const moveKey = (move: number) =>
  sqToName(move & 0xff) + sqToName((move >> 8) & 0xff);

/**
 * Root search for `side` with iterative deepening + a hard time budget.
 * Also returns the score of every root move (used by the coach).
 */
export function searchPosition(
  pos: Pos,
  side: number,
  maxDepth: number,
  timeLimitMs: number
): SearchOutcome {
  const start = Date.now();
  deadline = start + timeLimitMs;
  nodeCount = 0;
  aborted = false;

  ttUsed.fill(0);
  killerMoves.fill(0);
  historyTable.fill(0);

  const p = clonePos(pos);
  p.turn = side;

  const pseudoRoot = generateMoves(p, side, false);
  const legalRoot: number[] = [];
  for (let i = 0; i < pseudoRoot.length; i++) {
    const move = pseudoRoot[i];
    makeMove(p, move);
    if (isSquareAttacked(p.board, p.kings[side], side === BLACK)) {
      unmakeMove(p);
      continue;
    }
    legalRoot.push(move);
    unmakeMove(p);
  }

  if (legalRoot.length === 0) {
    return { move: null, score: 0, scores: {}, depth: 0, nodes: 0, ms: Date.now() - start };
  }

  let bestMove: number | null = null;
  let bestScore = -INF;
  let reachedDepth = 0;
  const finalScores: number[] = new Array(legalRoot.length).fill(0);

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INF;
    const beta = INF;
    let localBest: number | null = null;
    let localBestScore = -INF;
    const depthScores: number[] = new Array(legalRoot.length).fill(0);

    orderMoves(p, legalRoot, 0);

    for (let i = 0; i < legalRoot.length; i++) {
      const move = legalRoot[i];
      makeMove(p, move);
      const score = -negamax(p, depth - 1, -beta, -alpha, 1);
      unmakeMove(p);

      if (aborted) break;
      depthScores[i] = score;
      if (score > localBestScore) {
        localBestScore = score;
        localBest = move;
      }
      if (score > alpha) alpha = score;
    }

    if (aborted) break;

    reachedDepth = depth;
    bestMove = localBest;
    bestScore = Math.max(-MATE + 2, Math.min(MATE - 2, localBestScore));
    for (let i = 0; i < legalRoot.length; i++) finalScores[i] = depthScores[i];

    if (Math.abs(bestScore) > MATE - 100) break;
    if (Date.now() > deadline) break;
  }

  const scores: Record<string, number> = {};
  for (let i = 0; i < legalRoot.length; i++) {
    scores[moveKey(legalRoot[i])] = finalScores[i];
  }

  return {
    move: bestMove,
    score: bestScore,
    scores,
    depth: reachedDepth,
    nodes: nodeCount,
    ms: Date.now() - start,
  };
}

/** Legal move generation for the given side (used for validation / helpers). */
export function legalMoves(pos: Pos, side: number): number[] {
  const p = clonePos(pos);
  const pseudo = generateMoves(p, side, false);
  const out: number[] = [];
  for (let i = 0; i < pseudo.length; i++) {
    const move = pseudo[i];
    makeMove(p, move);
    if (isSquareAttacked(p.board, p.kings[side], side === BLACK)) {
      unmakeMove(p);
      continue;
    }
    unmakeMove(p);
    out.push(move);
  }
  return out;
}
