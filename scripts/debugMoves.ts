import {
  generateMoves, makeMove, unmakeMove, isSquareAttacked, WHITE, BLACK, sqToName,
} from '../src/chess/fastEngine';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PIECE_CHARS: Record<string, number> = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };

const [placement, sideF] = FEN.split(' ');
const board = new Int8Array(128);
const kings = new Int32Array(2);
const rows = placement.split('/');
for (let r = 0; r < 8; r++) {
  let col = 0;
  for (const ch of rows[r]) {
    if (ch >= '1' && ch <= '8') col += parseInt(ch, 10);
    else {
      const code = PIECE_CHARS[ch.toLowerCase()];
      const isWhite = ch === ch.toUpperCase();
      board[r * 16 + col] = isWhite ? code : -code;
      if (code === 6) kings[isWhite ? WHITE : BLACK] = r * 16 + col;
      col++;
    }
  }
}

console.log('white king sq:', kings[WHITE], 'black king sq:', kings[BLACK]);
console.log('e1 =', 7 * 16 + 4, 'b1 =', 7 * 16 + 1, 'g1 =', 7 * 16 + 6);

const pos: any = {
  board, turn: WHITE, castling: 15, ep: -1, kings, hash: 0,
};

const moves = generateMoves(pos, WHITE, false);
console.log('pseudo-legal moves:', moves.length);

const legal: string[] = [];
for (const m of moves) {
  makeMove(pos, m);
  const ok = !isSquareAttacked(pos.board, pos.kings[WHITE], WHITE === BLACK);
  unmakeMove(pos);
  if (ok) legal.push(sqToName(m & 0xff) + sqToName((m >> 8) & 0xff));
}
console.log('legal moves:', legal.length);
console.log(legal.sort().join(' '));

// Show raw generated moves grouped by from-square
const byFrom = new Map<string, string[]>();
for (const m of moves) {
  const k = sqToName(m & 0xff);
  if (!byFrom.has(k)) byFrom.set(k, []);
  byFrom.get(k)!.push(sqToName((m >> 8) & 0xff));
}
for (const [k, v] of byFrom) console.log(k, '->', v.join(','));
