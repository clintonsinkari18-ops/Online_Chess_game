/**
 * Verification script: validates the fast 0x88 engine against known
 * chess perft values and against the classic engine's move generator.
 *
 * Run with:
 *   npx esbuild scripts/verifyEngine.ts --bundle --platform=node --format=cjs --outfile=/tmp/verify.cjs && node /tmp/verify.cjs
 */
import {
  Pos,
  generateMoves,
  makeMove,
  unmakeMove,
  isSquareAttacked,
  searchPosition,
  WHITE,
  BLACK,
  computeHash,
  nameToSq,
  sqToName,
  CASTLE_WK,
  CASTLE_WQ,
  CASTLE_BK,
  CASTLE_BQ,
} from '../src/chess/fastEngine';
import {
  createInitialGameState,
  getLegalMoves,
  getAllLegalMoves,
  makeMove as classicMakeMove,
} from '../src/chess/engine';
import { GameState, Position } from '../src/chess/types';

const PIECE_CHARS: Record<string, number> = {
  p: 1, n: 2, b: 3, r: 4, q: 5, k: 6,
};
const CHAR_PIECES: Record<string, number> = {
  1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q', 6: 'k',
};

/** Parses a FEN string into a fast-engine Pos. */
function posFromFen(fen: string): Pos {
  const [placement, side, castling, epField] = fen.split(' ');
  const board = new Int8Array(128);
  const kings = new Int32Array(2);
  kings[WHITE] = -1;
  kings[BLACK] = -1;

  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    const rowStr = rows[r];
    let col = 0;
    for (const ch of rowStr) {
      if (ch >= '1' && ch <= '8') {
        col += parseInt(ch, 10);
      } else {
        const code = PIECE_CHARS[ch.toLowerCase()];
        const isWhite = ch === ch.toUpperCase();
        const sq = r * 16 + col;
        board[sq] = isWhite ? code : -code;
        if (code === 6) kings[isWhite ? WHITE : BLACK] = sq;
        col++;
      }
    }
  }

  let castlingMask = 0;
  if (castling.includes('K')) castlingMask |= CASTLE_WK;
  if (castling.includes('Q')) castlingMask |= CASTLE_WQ;
  if (castling.includes('k')) castlingMask |= CASTLE_BK;
  if (castling.includes('q')) castlingMask |= CASTLE_BQ;

  const ep = epField && epField !== '-' ? nameToSq(epField) : -1;

  const pos: Pos = {
    board,
    turn: side === 'w' ? WHITE : BLACK,
    castling: castlingMask,
    ep,
    kings,
    hash: 0,
  };
  pos.hash = computeHash(pos);
  return pos;
}

function perft(pos: Pos, depth: number): number {
  if (depth === 0) return 1;
  const side = pos.turn;
  const moves = generateMoves(pos, side, false);
  let nodes = 0;
  for (const m of moves) {
    makeMove(pos, m);
    if (isSquareAttacked(pos.board, pos.kings[side], side === BLACK)) {
      unmakeMove(pos);
      continue;
    }
    nodes += perft(pos, depth - 1);
    unmakeMove(pos);
  }
  return nodes;
}

let failures = 0;
function check(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`
  );
}

console.log('── Perft: starting position ──');
{
  const pos = posFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  check('perft(1)', perft(pos, 1), 20);
  check('perft(2)', perft(pos, 2), 400);
  check('perft(3)', perft(pos, 3), 8902);
  check('perft(4)', perft(pos, 4), 197281);
  check('perft(5)', perft(pos, 5), 4865609);
}

console.log('\n── Perft: Kiwipete (castling, en-passant, promotions) ──');
{
  const pos = posFromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  check('perft(1)', perft(pos, 1), 48);
  check('perft(2)', perft(pos, 2), 2039);
  check('perft(3)', perft(pos, 3), 97862);
  check('perft(4)', perft(pos, 4), 4085603);
}

console.log('\n── Perft: Position 3 (en-passant edge cases) ──');
{
  const pos = posFromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  check('perft(4)', perft(pos, 4), 43238);
  check('perft(5)', perft(pos, 5), 674624);
}

console.log('\n── Perft: Position 4 (promotions + en-passant) ──');
{
  const pos = posFromFen(
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'
  );
  check('perft(4)', perft(pos, 4), 422333);
}

console.log('\n── Perft: Position 5 ──');
{
  const pos = posFromFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8');
  check('perft(4)', perft(pos, 4), 2103487);
}

console.log('\n── Move-generation agreement with the classic engine ──');
{
  let mismatches = 0;
  let positions = 0;

  const normalise = (s: string) =>
    s
      .replace(/queen$/, 'q')
      .replace(/rook$/, 'r')
      .replace(/bishop$/, 'b')
      .replace(/knight$/, 'n');

  const compare = (state: GameState, label: string) => {
    positions++;
    const side = state.turn === 'white' ? WHITE : BLACK;

    const board = new Int8Array(128);
    const kings = new Int32Array(2);
    kings[WHITE] = -1;
    kings[BLACK] = -1;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = state.board[row][col];
        if (!piece) continue;
        const code = PIECE_CHARS[piece.type[0]];
        board[row * 16 + col] = piece.color === 'white' ? code : -code;
        if (piece.type === 'king') kings[piece.color === 'white' ? WHITE : BLACK] = row * 16 + col;
      }
    }
    let castling = 0;
    const wk = state.board[7][4];
    if (wk?.type === 'king' && !wk.hasMoved) {
      if (state.board[7][7]?.type === 'rook' && !state.board[7][7]?.hasMoved) castling |= CASTLE_WK;
      if (state.board[7][0]?.type === 'rook' && !state.board[7][0]?.hasMoved) castling |= CASTLE_WQ;
    }
    const bk = state.board[0][4];
    if (bk?.type === 'king' && !bk.hasMoved) {
      if (state.board[0][7]?.type === 'rook' && !state.board[0][7]?.hasMoved) castling |= CASTLE_BK;
      if (state.board[0][0]?.type === 'rook' && !state.board[0][0]?.hasMoved) castling |= CASTLE_BQ;
    }
    const pos: Pos = {
      board,
      turn: side,
      castling,
      ep: state.enPassantTarget ? state.enPassantTarget.row * 16 + state.enPassantTarget.col : -1,
      kings,
      hash: 0,
    };
    pos.hash = computeHash(pos);

    const fast = new Set<string>();
    const pseudo = generateMoves(pos, side, false);
    for (const m of pseudo) {
      makeMove(pos, m);
      const legal = !isSquareAttacked(pos.board, pos.kings[side], side === BLACK);
      unmakeMove(pos);
      if (!legal) continue;
      const promo = (m >> 16) & 7;
      const promoName = promo ? ['Q', 'R', 'B', 'N'][promo - 1] : '';
      fast.add(sqToName(m & 0xff) + sqToName((m >> 8) & 0xff) + promoName);
    }

    const classic = new Set<string>();
    const all = getAllLegalMoves(state.board, state.turn, state.enPassantTarget);
    for (const mv of all) {
      const from = 'abcdefgh'[mv.from.col] + String(8 - mv.from.row);
      const to = 'abcdefgh'[mv.to.col] + String(8 - mv.to.row);
      const pc =
        mv.promotion === 'queen' ? 'Q'
        : mv.promotion === 'rook' ? 'R'
        : mv.promotion === 'bishop' ? 'B'
        : mv.promotion === 'knight' ? 'N'
        : '';
      classic.add(from + to + pc);
    }

    for (const k of fast) if (!classic.has(k)) { mismatches++; console.log(`  ${label}: fast-only ${k}`); }
    for (const k of classic) if (!fast.has(k)) { mismatches++; console.log(`  ${label}: classic-only ${k}`); }
  };

  let state = createInitialGameState();
  compare(state, 'start');

  const seq: [string, string][] = [
    ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'],
    ['f1', 'b5'], ['a7', 'a6'], ['b5', 'a4'], ['g8', 'f6'],
    ['e1', 'g1'], ['f8', 'c5'], ['f1', 'e1'], ['d7', 'd6'],
    ['d2', 'd4'], ['c5', 'g1'], ['b2', 'b3'], ['c2', 'c3'],
    ['d1', 'd2'], ['c8', 'd7'], ['c1', 'g5'], ['d7', 'e5'],
  ];
  const toPos = (sq: string): Position => ({
    row: 8 - parseInt(sq[1], 10),
    col: 'abcdefgh'.indexOf(sq[0]),
  });
  for (let i = 0; i < seq.length; i++) {
    const from = toPos(seq[i][0]);
    const to = toPos(seq[i][1]);
    const moves = getLegalMoves(state.board, from, state.enPassantTarget);
    const mv = moves.find((m) => m.to.row === to.row && m.to.col === to.col);
    if (!mv) { console.log(`  (stopped at ply ${i})`); break; }
    state = classicMakeMove(state, {
      from: mv.from, to: mv.to, piece: mv.piece,
      captured: mv.captured, isEnPassant: mv.isEnPassant, isCastling: mv.isCastling, promotion: mv.promotion,
    });
    compare(state, `ply${i}`);
  }

  const ok = mismatches === 0;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${positions} positions compared, ${mismatches} mismatches`);
}

console.log('\n── Search sanity ──');
{
  const pos = posFromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  const outcome = searchPosition(pos, WHITE, 5, 1000);
  const found =
    outcome.move !== null
      ? sqToName(outcome.move & 0xff) + sqToName((outcome.move >> 8) & 0xff)
      : 'none';
  const ok = found === 'a1a8';
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  mate in 1 -> ${found} (want a1a8) | score ${outcome.score} | depth ${outcome.depth} | ${outcome.nodes} nodes | ${outcome.ms}ms`
  );
}

console.log('\n── Speed benchmark (coach settings: depth 9, 220ms budget) ──');
{
  const pos = posFromFen(
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
  );
  const t0 = Date.now();
  const outcome = searchPosition(pos, WHITE, 9, 220);
  const ms = Date.now() - t0;
  console.log(
    `  depth ${outcome.depth}, ${outcome.nodes} nodes, ${outcome.ms}ms engine time (${ms}ms wall), score ${outcome.score}`
  );
  const ok = ms < 600 && outcome.depth >= 6;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  search completed quickly and deeply`);
}

console.log(failures === 0 ? '\n✅ ALL CHECKS PASSED' : `\n❌ ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
