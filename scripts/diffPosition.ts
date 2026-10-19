import {
  Pos, generateMoves, makeMove, unmakeMove, isSquareAttacked, WHITE, BLACK,
  computeHash, nameToSq, sqToName, CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
} from '../src/chess/fastEngine';
import { getAllLegalMoves } from '../src/chess/engine';
import { GameState, Piece, PieceType, Color } from '../src/chess/types';

const CHAR: Record<string, PieceType> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
const CODE: Record<PieceType, number> = {
  pawn: 1, knight: 2, bishop: 3, rook: 4, queen: 5, king: 6,
};

/** FEN -> classic-engine GameState */
function classicFromFen(fen: string): GameState {
  const [placement, side, castling, epField] = fen.split(' ');
  const board: (Piece | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    let col = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { col += parseInt(ch, 10); continue; }
      const isWhite = ch === ch.toUpperCase();
      const type = CHAR[ch.toLowerCase()] as PieceType;
      board[r][col] = { type, color: (isWhite ? 'white' : 'black') as Color, hasMoved: false };
      col++;
    }
  }
  // mark moved kings/rooks so castling rights line up
  const wk = board[7][4];
  if (castling.indexOf('K') === -1 && wk) wk.hasMoved = true;
  const wq = board[7][0];
  if (castling.indexOf('Q') === -1 && wq) wq.hasMoved = true;
  const bk = board[0][4];
  if (castling.indexOf('k') === -1 && bk) bk.hasMoved = true;
  const bq = board[0][0];
  if (castling.indexOf('q') === -1 && bq) bq.hasMoved = true;

  return {
    board,
    turn: side === 'w' ? 'white' : 'black',
    moveHistory: [],
    status: 'playing',
    enPassantTarget: epField && epField !== '-' ? { row: 8 - parseInt(epField[1], 10), col: epField.charCodeAt(0) - 97 } : null,
    halfMoveClock: 0,
    positionHistory: [],
  };
}

/** FEN -> fast-engine Pos */
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
  const pos: Pos = {
    board, turn: side === 'w' ? WHITE : BLACK, castling: mask,
    ep: epField && epField !== '-' ? nameToSq(epField) : -1, kings, hash: 0,
  };
  pos.hash = computeHash(pos);
  return pos;
}

const norm = (s: string) =>
  s.replace(/queen$/, 'Q').replace(/rook$/, 'R').replace(/bishop$/, 'B').replace(/knight$/, 'N');

const FENS = [
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R b KQkq - 0 1',
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
];

for (const fen of FENS) {
  console.log('\n===', fen, '===');
  const classic = classicFromFen(fen);
  const fast = fastFromFen(fen);
  const side = classic.turn === 'white' ? WHITE : BLACK;

  const fastSet = new Set<string>();
  const pseudo = generateMoves(fast, side, false);
  for (const m of pseudo) {
    makeMove(fast, m);
    const legal = !isSquareAttacked(fast.board, fast.kings[side], side === BLACK);
    unmakeMove(fast);
    if (!legal) continue;
    const promo = (m >> 16) & 7;
    const pname = promo ? ['Q', 'R', 'B', 'N'][promo - 1] : '';
    fastSet.add(norm(sqToName(m & 0xff) + sqToName((m >> 8) & 0xff) + pname));
  }

  const classicSet = new Set<string>();
  for (const mv of getAllLegalMoves(classic.board, classic.turn, classic.enPassantTarget)) {
    const from = 'abcdefgh'[mv.from.col] + String(8 - mv.from.row);
    const to = 'abcdefgh'[mv.to.col] + String(8 - mv.to.row);
    classicSet.add(norm(from + to + (mv.promotion ? mv.promotion.toUpperCase().slice(0, 1) : '')));
  }

  const onlyClassic = [...classicSet].filter((k) => !fastSet.has(k));
  const onlyFast = [...fastSet].filter((k) => !classicSet.has(k));
  console.log(`  classic=${classicSet.size} fast=${fastSet.size}`);
  if (onlyClassic.length) console.log('  MISSING in fast :', onlyClassic.join(' '));
  if (onlyFast.length) console.log('  EXTRA in fast   :', onlyFast.join(' '));
  if (!onlyClassic.length && !onlyFast.length) console.log('  ✔ identical');
}
