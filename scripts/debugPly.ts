import { Pos, generateMoves, makeMove, unmakeMove, isSquareAttacked, WHITE, BLACK, computeHash, sqToName, CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ } from '../src/chess/fastEngine';
import { getLegalMoves, makeMove as classicMakeMove } from '../src/chess/engine';
import { Position } from '../src/chess/types';

const PIECE_CHARS: Record<string, number> = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };

let state = (await import('../src/chess/engine')).createInitialGameState();

const seq: [string, string][] = [
  ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'],
  ['f1', 'b5'], ['a7', 'a6'], ['b5', 'a4'], ['g8', 'f6'],
  ['e1', 'g1'], ['f8', 'c5'], ['f1', 'e1'], ['d7', 'd6'],
  ['d2', 'd4'], ['c5', 'g1'], ['b2', 'b3'], ['c2', 'c3'],
  ['d1', 'd2'], ['c8', 'd7'], ['c1', 'g5'], ['d7', 'e5'],
];
const toPos = (sq: string): Position => ({ row: 8 - parseInt(sq[1], 10), col: 'abcdefgh'.indexOf(sq[0]) });

for (let i = 0; i < seq.length; i++) {
  const from = toPos(seq[i][0]);
  const to = toPos(seq[i][1]);
  const moves = getLegalMoves(state.board, from, state.enPassantTarget);
  const mv = moves.find((m) => m.to.row === to.row && m.to.col === to.col);
  if (!mv) { console.log('no move at ply', i); break; }
  state = classicMakeMove(state, {
    from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured,
    isEnPassant: mv.isEnPassant, isCastling: mv.isCastling, promotion: mv.promotion,
  });

  if (i === 10 || i === 11) {
    console.log(`\n--- ply ${i} (after ${seq[i][0]}${seq[i][1]}) ---`);
    for (let row = 0; row < 8; row++) {
      let line = '';
      for (let col = 0; col < 8; col++) {
        const p = state.board[row][col];
        line += p ? (p.color === 'white' ? p.type[0].toUpperCase() : p.type[0]) : '.';
        line += ' ';
      }
      console.log('  ' + line);
    }
    // build fast board
    const board = new Int8Array(128);
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const p = state.board[row][col];
      if (!p) continue;
      const code = PIECE_CHARS[p.type[0]];
      board[row * 16 + col] = p.color === 'white' ? code : -code;
    }
    console.log('  fast board row5 (rank 3):', Array.from(board.slice(80, 88)).join(','));
    console.log('  fast board row7 (rank 1):', Array.from(board.slice(112, 120)).join(','));
    const kings = new Int32Array(2);
    kings[WHITE] = -1; kings[BLACK] = -1;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const p = state.board[row][col];
      if (p?.type === 'king') kings[p.color === 'white' ? WHITE : BLACK] = row * 16 + col;
    }
    const pos: Pos = { board, turn: state.turn === 'white' ? WHITE : BLACK, castling: 0, ep: -1, kings, hash: 0 };
    pos.hash = computeHash(pos);
    const side = state.turn === 'white' ? WHITE : BLACK;
    const out: string[] = [];
    for (const m of generateMoves(pos, side, false)) {
      makeMove(pos, m);
      const legal = !isSquareAttacked(pos.board, pos.kings[side], side === BLACK);
      unmakeMove(pos);
      if (legal) out.push(sqToName(m & 0xff) + sqToName((m >> 8) & 0xff));
    }
    console.log('  fast legal count:', out.length, out.slice(0, 12).join(' '));
  }
}
