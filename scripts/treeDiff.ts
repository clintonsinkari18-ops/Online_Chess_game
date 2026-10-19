import {
  Pos, generateMoves, makeMove, unmakeMove, isSquareAttacked, WHITE, BLACK,
  computeHash, nameToSq, sqToName, CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
} from '../src/chess/fastEngine';
import { getAllLegalMoves, makeMove as classicMakeMove, cloneBoard, applyMoveToBoard } from '../src/chess/engine';
import { GameState, Piece, PieceType, Color } from '../src/chess/types';

const CHAR: Record<string, PieceType> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const CODE: Record<PieceType, number> = { pawn: 1, knight: 2, bishop: 3, rook: 4, queen: 5, king: 6 };

function classicFromFen(fen: string): GameState {
  const [placement, side, castling, epField] = fen.split(' ');
  const board: (Piece | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    let col = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { col += parseInt(ch, 10); continue; }
      const isWhite = ch === ch.toUpperCase();
      board[r][col] = { type: CHAR[ch.toLowerCase()], color: (isWhite ? 'white' : 'black') as Color, hasMoved: false };
      col++;
    }
  }
  // Castling rights: a rook that lost its right has moved; the king has moved
  // only if BOTH of its rights are gone.
  const wk = board[7][4];
  if (wk && castling.indexOf('K') === -1 && castling.indexOf('Q') === -1) wk.hasMoved = true;
  const wr1 = board[7][7]; if (wr1 && castling.indexOf('K') === -1) wr1.hasMoved = true;
  const wr2 = board[7][0]; if (wr2 && castling.indexOf('Q') === -1) wr2.hasMoved = true;
  const bk = board[0][4];
  if (bk && castling.indexOf('k') === -1 && castling.indexOf('q') === -1) bk.hasMoved = true;
  const br1 = board[0][7]; if (br1 && castling.indexOf('k') === -1) br1.hasMoved = true;
  const br2 = board[0][0]; if (br2 && castling.indexOf('q') === -1) br2.hasMoved = true;
  return {
    board, turn: side === 'w' ? 'white' : 'black', moveHistory: [], status: 'playing',
    enPassantTarget: epField && epField !== '-' ? { row: 8 - parseInt(epField[1], 10), col: epField.charCodeAt(0) - 97 } : null,
    halfMoveClock: 0, positionHistory: [],
  };
}

function fastFromFen(fen: string): Pos {
  const [placement, side, castling, epField] = fen.split(' ');
  const board = new Int8Array(128);
  const kings = new Int32Array(2);
  kings[WHITE] = -1; kings[BLACK] = -1;
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    let col = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { col += parseInt(ch, 10); continue; }
      const code = CODE[CHAR[ch.toLowerCase()]];
      const isWhite = ch === ch.toUpperCase();
      board[r * 16 + col] = isWhite ? code : -code;
      if (code === 6) kings[isWhite ? WHITE : BLACK] = r * 16 + col;
      col++;
    }
  }
  let mask = 0;
  if (castling.includes('K')) mask |= CASTLE_WK;
  if (castling.includes('Q')) mask |= CASTLE_WQ;
  if (castling.includes('k')) mask |= CASTLE_BK;
  if (castling.includes('q')) mask |= CASTLE_BQ;
  const pos: Pos = { board, turn: side === 'w' ? WHITE : BLACK, castling: mask,
    ep: epField && epField !== '-' ? nameToSq(epField) : -1, kings, hash: 0 };
  pos.hash = computeHash(pos);
  return pos;
}

const FEN = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

function fastLegal(pos: Pos, side: number): { key: string; enc: number }[] {
  const out: { key: string; enc: number }[] = [];
  const pseudo = generateMoves(pos, side, false);
  for (const m of pseudo) {
    makeMove(pos, m);
    const legal = !isSquareAttacked(pos.board, pos.kings[side], side === BLACK);
    unmakeMove(pos);
    if (!legal) continue;
    const promo = (m >> 16) & 7;
    const pname = promo ? ['Q', 'R', 'B', 'N'][promo - 1] : '';
    out.push({ key: sqToName(m & 0xff) + sqToName((m >> 8) & 0xff) + pname, enc: m });
  }
  return out;
}

/** Walks both engines in lock-step and reports the first divergence. */
function walk(fen: string, depth: number) {
  const classic = classicFromFen(fen);
  const fast = fastFromFen(fen);
  const side = classic.turn === 'white' ? WHITE : BLACK;

  const f = fastLegal(fast, side);
  const c = getAllLegalMoves(classic.board, classic.turn, classic.enPassantTarget).map((mv) => {
    const from = 'abcdefgh'[mv.from.col] + String(8 - mv.from.row);
    const to = 'abcdefgh'[mv.to.col] + String(8 - mv.to.row);
    const pc = mv.promotion === 'queen' ? 'Q' : mv.promotion === 'rook' ? 'R' : mv.promotion === 'bishop' ? 'B' : mv.promotion === 'knight' ? 'N' : '';
    return { key: from + to + pc, mv };
  });

  const fk = new Set(f.map((x) => x.key));
  const ck = new Set(c.map((x) => x.key));
  const onlyF = [...fk].filter((k) => !ck.has(k));
  const onlyC = [...ck].filter((k) => !fk.has(k));

  if (onlyF.length || onlyC.length) {
    console.log(`DIVERGENCE at depth ${depth}, fen="${fen}"`);
    if (onlyC.length) console.log('  classic-only:', onlyC.join(' '));
    if (onlyF.length) console.log('  fast-only   :', onlyF.join(' '));
    return false;
  }
  if (depth === 0) return true;

  // recurse with each move
  for (const item of f) {
    // build child FEN-ish state for both engines
    const cMove = c.find((x) => x.key === item.key);
    if (!cMove) continue;
    const childClassic = classicMakeMove(classic, cMove.mv);
    // fast: apply the encoded move
    makeMove(fast, item.enc);
    const childFast = {
      board: fast.board.slice(), turn: fast.turn, castling: fast.castling, ep: fast.ep,
      kings: fast.kings.slice(), hash: fast.hash,
    };
    unmakeMove(fast);
    // derive child FEN from the classic engine
    const fenChild = toFen(childClassic);
    if (!walk(fenChild, depth - 1)) return false;
  }
  return true;
}

function toFen(state: GameState): string {
  let placement = '';
  for (let row = 0; row < 8; row++) {
    let empty = 0;
    for (let col = 0; col < 8; col++) {
      const p = state.board[row][col];
      if (!p) { empty++; continue; }
      if (empty) { placement += empty; empty = 0; }
      const ch = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' }[p.type];
      placement += p.color === 'white' ? ch.toUpperCase() : ch;
    }
    if (empty) placement += empty;
    if (row < 7) placement += '/';
  }
  let castling = '';
  const wk = state.board[7][4], wq = state.board[7][0], bk = state.board[0][4], bq = state.board[0][0];
  if (wk?.type === 'king' && !wk.hasMoved) { if (state.board[7][7]?.type === 'rook' && !state.board[7][7]?.hasMoved) castling += 'K'; if (state.board[7][0]?.type === 'rook' && !state.board[7][0]?.hasMoved) castling += 'Q'; }
  if (bk?.type === 'king' && !bk.hasMoved) { if (state.board[0][7]?.type === 'rook' && !state.board[0][7]?.hasMoved) castling += 'k'; if (state.board[0][0]?.type === 'rook' && !state.board[0][0]?.hasMoved) castling += 'q'; }
  if (!castling) castling = '-';
  const ep = state.enPassantTarget
    ? 'abcdefgh'[state.enPassantTarget.col] + String(8 - state.enPassantTarget.row)
    : '-';
  return `${placement} ${state.turn} ${castling} ${ep} 0 1`;
}

walk(FEN, 3);
