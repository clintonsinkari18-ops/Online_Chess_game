import {
  Board,
  Color,
  GameState,
  Move,
  Piece,
  PieceType,
  Position,
} from './types';

export function createInitialBoard(): Board {
  const board: Board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));

  const backRow: PieceType[] = [
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
    'bishop',
    'knight',
    'rook',
  ];

  for (let col = 0; col < 8; col++) {
    board[0][col] = { type: backRow[col], color: 'black', hasMoved: false };
    board[1][col] = { type: 'pawn', color: 'black', hasMoved: false };
    board[6][col] = { type: 'pawn', color: 'white', hasMoved: false };
    board[7][col] = { type: backRow[col], color: 'white', hasMoved: false };
  }

  return board;
}

export function createInitialGameState(): GameState {
  return {
    board: createInitialBoard(),
    turn: 'white',
    moveHistory: [],
    status: 'playing',
    enPassantTarget: null,
    halfMoveClock: 0,
    positionHistory: [],
  };
}

export function cloneBoard(board: Board): Board {
  return board.map((row) =>
    row.map((square) => (square ? { ...square } : null))
  );
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function findKing(board: Board, color: Color): Position | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'king' && p.color === color) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

export function isSquareAttacked(
  board: Board,
  pos: Position,
  byColor: Color
): boolean {
  const { row, col } = pos;

  // Knight attacks
  const knightMoves = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];
  for (const [dr, dc] of knightMoves) {
    const r = row + dr, c = col + dc;
    if (inBounds(r, c)) {
      const p = board[r][c];
      if (p && p.color === byColor && p.type === 'knight') return true;
    }
  }

  // King attacks
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr, c = col + dc;
      if (inBounds(r, c)) {
        const p = board[r][c];
        if (p && p.color === byColor && p.type === 'king') return true;
      }
    }
  }

  // Pawn attacks
  const pawnDir = byColor === 'white' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const r = row + pawnDir, c = col + dc;
    if (inBounds(r, c)) {
      const p = board[r][c];
      if (p && p.color === byColor && p.type === 'pawn') return true;
    }
  }

  // Sliding pieces (rook/queen for straights, bishop/queen for diagonals)
  const straightDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  for (const [dr, dc] of straightDirs) {
    let r = row + dr, c = col + dc;
    while (inBounds(r, c)) {
      const p = board[r][c];
      if (p) {
        if (
          p.color === byColor &&
          (p.type === 'rook' || p.type === 'queen')
        )
          return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  for (const [dr, dc] of diagDirs) {
    let r = row + dr, c = col + dc;
    while (inBounds(r, c)) {
      const p = board[r][c];
      if (p) {
        if (
          p.color === byColor &&
          (p.type === 'bishop' || p.type === 'queen')
        )
          return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return false;
}

export function isInCheck(board: Board, color: Color): boolean {
  const king = findKing(board, color);
  if (!king) return false;
  const opponent = color === 'white' ? 'black' : 'white';
  return isSquareAttacked(board, king, opponent);
}

function getPseudoLegalMoves(
  board: Board,
  pos: Position,
  enPassantTarget: Position | null
): Move[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  const moves: Move[] = [];
  const { row, col } = pos;
  const color = piece.color;
  const opponent: Color = color === 'white' ? 'black' : 'white';

  const addMove = (toRow: number, toCol: number, extra?: Partial<Move>) => {
    if (!inBounds(toRow, toCol)) return;
    const target = board[toRow][toCol];
    if (target && target.color === color) return;
    moves.push({
      from: pos,
      to: { row: toRow, col: toCol },
      piece,
      captured: target || undefined,
      ...extra,
    });
  };

  switch (piece.type) {
    case 'pawn': {
      const dir = color === 'white' ? -1 : 1;
      const startRow = color === 'white' ? 6 : 1;
      const promoRow = color === 'white' ? 0 : 7;

      // Forward
      if (inBounds(row + dir, col) && !board[row + dir][col]) {
        if (row + dir === promoRow) {
          for (const promo of ['queen', 'rook', 'bishop', 'knight'] as PieceType[]) {
            moves.push({
              from: pos,
              to: { row: row + dir, col },
              piece,
              promotion: promo,
            });
          }
        } else {
          moves.push({ from: pos, to: { row: row + dir, col }, piece });
        }
        // Double push
        if (row === startRow && !board[row + 2 * dir][col]) {
          moves.push({ from: pos, to: { row: row + 2 * dir, col }, piece });
        }
      }
      // Captures
      for (const dc of [-1, 1]) {
        const nr = row + dir, nc = col + dc;
        if (!inBounds(nr, nc)) continue;
        const target = board[nr][nc];
        if (target && target.color === opponent) {
          if (nr === promoRow) {
            for (const promo of ['queen', 'rook', 'bishop', 'knight'] as PieceType[]) {
              moves.push({
                from: pos,
                to: { row: nr, col: nc },
                piece,
                captured: target,
                promotion: promo,
              });
            }
          } else {
            moves.push({
              from: pos,
              to: { row: nr, col: nc },
              piece,
              captured: target,
            });
          }
        }
        // En passant — only when an enemy pawn actually sits beside us
        if (enPassantTarget && nr === enPassantTarget.row && nc === enPassantTarget.col) {
          const capturedPawn = board[row][nc];
          if (
            capturedPawn &&
            capturedPawn.type === 'pawn' &&
            capturedPawn.color === opponent
          ) {
            moves.push({
              from: pos,
              to: { row: nr, col: nc },
              piece,
              captured: capturedPawn,
              isEnPassant: true,
            });
          }
        }
      }
      break;
    }
    case 'knight': {
      const knightMoves = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1],
      ];
      for (const [dr, dc] of knightMoves) {
        addMove(row + dr, col + dc);
      }
      break;
    }
    case 'bishop': {
      const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (const [dr, dc] of dirs) {
        let r = row + dr, c = col + dc;
        while (inBounds(r, c)) {
          const target = board[r][c];
          if (target) {
            if (target.color === opponent) {
              moves.push({ from: pos, to: { row: r, col: c }, piece, captured: target });
            }
            break;
          }
          moves.push({ from: pos, to: { row: r, col: c }, piece });
          r += dr;
          c += dc;
        }
      }
      break;
    }
    case 'rook': {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        let r = row + dr, c = col + dc;
        while (inBounds(r, c)) {
          const target = board[r][c];
          if (target) {
            if (target.color === opponent) {
              moves.push({ from: pos, to: { row: r, col: c }, piece, captured: target });
            }
            break;
          }
          moves.push({ from: pos, to: { row: r, col: c }, piece });
          r += dr;
          c += dc;
        }
      }
      break;
    }
    case 'queen': {
      const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
      for (const [dr, dc] of dirs) {
        let r = row + dr, c = col + dc;
        while (inBounds(r, c)) {
          const target = board[r][c];
          if (target) {
            if (target.color === opponent) {
              moves.push({ from: pos, to: { row: r, col: c }, piece, captured: target });
            }
            break;
          }
          moves.push({ from: pos, to: { row: r, col: c }, piece });
          r += dr;
          c += dc;
        }
      }
      break;
    }
    case 'king': {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          addMove(row + dr, col + dc);
        }
      }
      // Castling — only legal from the king's home square (e1 / e8)
      if (!piece.hasMoved && col === 4 && !isInCheck(board, color)) {
        // Kingside
        const kRook = board[row][7];
        if (
          kRook &&
          kRook.type === 'rook' &&
          kRook.color === color &&
          !kRook.hasMoved &&
          !board[row][5] &&
          !board[row][6] &&
          !isSquareAttacked(board, { row, col: 5 }, opponent) &&
          !isSquareAttacked(board, { row, col: 6 }, opponent)
        ) {
          moves.push({
            from: pos,
            to: { row, col: 6 },
            piece,
            isCastling: 'kingside',
          });
        }
        // Queenside
        const qRook = board[row][0];
        if (
          qRook &&
          qRook.type === 'rook' &&
          qRook.color === color &&
          !qRook.hasMoved &&
          !board[row][1] &&
          !board[row][2] &&
          !board[row][3] &&
          !isSquareAttacked(board, { row, col: 2 }, opponent) &&
          !isSquareAttacked(board, { row, col: 3 }, opponent)
        ) {
          moves.push({
            from: pos,
            to: { row, col: 2 },
            piece,
            isCastling: 'queenside',
          });
        }
      }
      break;
    }
  }

  return moves;
}

export function getLegalMoves(
  board: Board,
  pos: Position,
  enPassantTarget: Position | null
): Move[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  const pseudoMoves = getPseudoLegalMoves(board, pos, enPassantTarget);
  const legalMoves: Move[] = [];

  for (const move of pseudoMoves) {
    const newBoard = cloneBoard(board);
    applyMoveToBoard(newBoard, move);
    if (!isInCheck(newBoard, piece.color)) {
      legalMoves.push(move);
    }
  }

  return legalMoves;
}

export function getAllLegalMoves(
  board: Board,
  color: Color,
  enPassantTarget: Position | null
): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.color === color) {
        moves.push(...getLegalMoves(board, { row: r, col: c }, enPassantTarget));
      }
    }
  }
  return moves;
}

export function applyMoveToBoard(board: Board, move: Move): void {
  const { from, to, piece, isCastling, isEnPassant, promotion } = move;

  board[to.row][to.col] = promotion
    ? { type: promotion, color: piece.color, hasMoved: true }
    : { ...piece, hasMoved: true };
  board[from.row][from.col] = null;

  if (isCastling === 'kingside') {
    board[from.row][5] = { ...board[from.row][7]!, hasMoved: true };
    board[from.row][7] = null;
  } else if (isCastling === 'queenside') {
    board[from.row][3] = { ...board[from.row][0]!, hasMoved: true };
    board[from.row][0] = null;
  }

  if (isEnPassant) {
    board[from.row][to.col] = null;
  }
}

export function makeMove(state: GameState, move: Move): GameState {
  const newBoard = cloneBoard(state.board);
  applyMoveToBoard(newBoard, move);

  // En passant target
  let newEnPassant: Position | null = null;
  if (
    move.piece.type === 'pawn' &&
    Math.abs(move.to.row - move.from.row) === 2
  ) {
    newEnPassant = {
      row: (move.from.row + move.to.row) / 2,
      col: move.from.col,
    };
  }

  // Half move clock
  const newHalfMoveClock =
    move.piece.type === 'pawn' || move.captured
      ? 0
      : state.halfMoveClock + 1;

  const newTurn: Color = state.turn === 'white' ? 'black' : 'white';

  // Notation
  const notation = generateNotation(move, newBoard, newTurn);
  const moveWithNotation = { ...move, notation };

  const newState: GameState = {
    board: newBoard,
    turn: newTurn,
    moveHistory: [...state.moveHistory, moveWithNotation],
    enPassantTarget: newEnPassant,
    halfMoveClock: newHalfMoveClock,
    positionHistory: state.positionHistory,
    status: 'playing',
  };

  // Determine game status
  const allMoves = getAllLegalMoves(newBoard, newTurn, newEnPassant);
  const inCheck = isInCheck(newBoard, newTurn);

  if (allMoves.length === 0) {
    newState.status = inCheck ? 'checkmate' : 'stalemate';
  } else if (inCheck) {
    newState.status = 'check';
  } else if (newHalfMoveClock >= 100) {
    newState.status = 'draw';
  }

  // Position history for threefold repetition
  newState.positionHistory = [
    ...state.positionHistory,
    boardToString(newBoard),
  ];

  // Check threefold repetition
  const currentPos = boardToString(newBoard);
  const count = newState.positionHistory.filter((p) => p === currentPos).length;
  if (count >= 3) {
    newState.status = 'draw';
  }

  return newState;
}

function generateNotation(move: Move, _board: Board, _nextTurn: Color): string {
  if (move.isCastling === 'kingside') return 'O-O';
  if (move.isCastling === 'queenside') return 'O-O-O';

  const files = 'abcdefgh';
  const ranks = '87654321';
  let notation = '';

  if (move.piece.type !== 'pawn') {
    notation += move.piece.type === 'knight' ? 'N' : move.piece.type[0].toUpperCase();
  }

  if (move.captured) {
    if (move.piece.type === 'pawn') {
      notation += files[move.from.col];
    }
    notation += 'x';
  }

  notation += files[move.to.col] + ranks[move.to.row];

  if (move.promotion) {
    notation += '=' + (move.promotion === 'knight' ? 'N' : move.promotion[0].toUpperCase());
  }

  return notation;
}

function boardToString(board: Board): string {
  return board
    .map((row) =>
      row
        .map((p) => (p ? `${p.color[0]}${p.type[0]}` : '--'))
        .join('')
    )
    .join('/');
}

export function getCapturedPieces(state: GameState): { white: Piece[]; black: Piece[] } {
  const captured: { white: Piece[]; black: Piece[] } = {
    white: [],
    black: [],
  };

  for (const move of state.moveHistory) {
    if (move.captured) {
      captured[move.captured.color].push(move.captured);
    }
  }

  return captured;
}

export function sortPieces(pieces: Piece[]): Piece[] {
  const order: Record<PieceType, number> = {
    queen: 0,
    rook: 1,
    bishop: 2,
    knight: 3,
    pawn: 4,
    king: 5,
  };
  return [...pieces].sort((a, b) => order[a.type] - order[b.type]);
}
