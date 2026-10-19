import { GameState, Piece, PieceType } from './types';
import {
  Pos,
  WHITE,
  BLACK,
  CASTLE_WK,
  CASTLE_WQ,
  CASTLE_BK,
  CASTLE_BQ,
  computeHash,
  moveFrom,
  moveTo,
  movePromo,
  moveFlags,
  sqToName,
  nameToSq,
} from './fastEngine';

const TYPE_CODE: Record<PieceType, number> = {
  pawn: 1,
  knight: 2,
  bishop: 3,
  rook: 4,
  queen: 5,
  king: 6,
};

const CODE_TYPE: Record<number, PieceType> = {
  1: 'pawn',
  2: 'knight',
  3: 'bishop',
  4: 'rook',
  5: 'queen',
  6: 'king',
};

export interface PosPayload {
  board: number[]; // 128 slots
  turn: number; // WHITE | BLACK
  castling: number;
  ep: number; // -1 = none
}

/** Serialises a GameState into a flat, transferable position. */
export function gameStateToPayload(state: GameState): PosPayload {
  const board = new Array(128).fill(0);
  const kings = new Int32Array(2);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = state.board[row][col];
      if (!piece) continue;
      const code = TYPE_CODE[piece.type];
      board[row * 16 + col] = piece.color === 'white' ? code : -code;
      if (piece.type === 'king') {
        kings[piece.color === 'white' ? WHITE : BLACK] = row * 16 + col;
      }
    }
  }

  // Derive castling rights from piece placement + hasMoved flags
  let castling = 0;
  const whiteKing = state.board[7][4];
  if (whiteKing?.type === 'king' && !whiteKing.hasMoved) {
    const hRook = state.board[7][7];
    const aRook = state.board[7][0];
    if (hRook?.type === 'rook' && !hRook.hasMoved) castling |= CASTLE_WK;
    if (aRook?.type === 'rook' && !aRook.hasMoved) castling |= CASTLE_WQ;
  }
  const blackKing = state.board[0][4];
  if (blackKing?.type === 'king' && !blackKing.hasMoved) {
    const hRook = state.board[0][7];
    const aRook = state.board[0][0];
    if (hRook?.type === 'rook' && !hRook.hasMoved) castling |= CASTLE_BK;
    if (aRook?.type === 'rook' && !aRook.hasMoved) castling |= CASTLE_BQ;
  }

  const ep = state.enPassantTarget
    ? state.enPassantTarget.row * 16 + state.enPassantTarget.col
    : -1;

  return {
    board,
    turn: state.turn === 'white' ? WHITE : BLACK,
    castling,
    ep,
  };
}

/** Rebuilds a fast-engine Pos from a serialised payload. */
export function payloadToPos(payload: PosPayload): Pos {
  const board = new Int8Array(128);
  const kings = new Int32Array(2);
  kings[WHITE] = -1;
  kings[BLACK] = -1;

  for (let sq = 0; sq < 128; sq++) {
    const v = payload.board[sq];
    board[sq] = v;
    if (v === 6) kings[WHITE] = sq;
    else if (v === -6) kings[BLACK] = sq;
  }

  const pos: Pos = {
    board,
    turn: payload.turn,
    castling: payload.castling,
    ep: payload.ep,
    kings,
    hash: 0,
  };
  pos.hash = computeHash(pos);
  return pos;
}

/** Reconstructs a full Move object from an encoded fast-engine move. */
export function encodedToMove(
  encoded: number,
  state: GameState
): {
  from: { row: number; col: number };
  to: { row: number; col: number };
  piece: Piece;
  promotion?: PieceType;
  isEnPassant?: boolean;
  isCastling?: 'kingside' | 'queenside';
} {
  const fromSq = moveFrom(encoded);
  const toSq = moveTo(encoded);
  const promo = movePromo(encoded);
  const flags = moveFlags(encoded);

  const from = { row: fromSq >> 4, col: fromSq & 7 };
  const to = { row: toSq >> 4, col: toSq & 7 };
  const piece = state.board[from.row][from.col]!;

  return {
    from,
    to,
    piece,
    promotion: promo ? CODE_TYPE[promo === 1 ? 5 : promo === 2 ? 4 : promo === 3 ? 3 : 2] : undefined,
    isEnPassant: flags === 1 ? true : undefined,
    isCastling: flags === 2 ? 'kingside' : flags === 3 ? 'queenside' : undefined,
  };
}

export { sqToName, nameToSq, WHITE, BLACK };
