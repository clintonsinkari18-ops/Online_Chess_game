import {
  Board,
  Color,
  GameState,
  Move,
  Position,
  PIECE_SQUARE_TABLES,
  PIECE_VALUES,
} from './types';
import {
  cloneBoard,
  getAllLegalMoves,
  applyMoveToBoard,
  isInCheck,
} from './engine';

export type AIDifficulty = 'beginner' | 'amateur' | 'professional' | 'superstar';

// Optimized difficulty depths and randomness for lightning-fast calculations
const DIFFICULTY_CONFIG: Record<AIDifficulty, { depth: number; randomChance: number }> = {
  beginner: { depth: 1, randomChance: 0.22 },
  amateur: { depth: 2, randomChance: 0.06 },
  professional: { depth: 3, randomChance: 0.01 },
  superstar: { depth: 4, randomChance: 0 },
};

export function evaluateBoard(board: Board, aiColor: Color): number {
  let score = 0;
  const opponent: Color = aiColor === 'white' ? 'black' : 'white';

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const pstRow = piece.color === 'white' ? r : 7 - r;
      const value = PIECE_VALUES[piece.type] + (PIECE_SQUARE_TABLES[piece.type]?.[pstRow]?.[c] ?? 0);

      if (piece.color === aiColor) {
        score += value;
      } else {
        score -= value;
      }
    }
  }

  // Fast mobility evaluation
  const aiMoves = getAllLegalMoves(board, aiColor, null).length;
  const oppMoves = getAllLegalMoves(board, opponent, null).length;
  score += (aiMoves - oppMoves) * 4;

  return score;
}

export function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    let scoreA = 0;
    let scoreB = 0;

    // MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
    if (a.captured) {
      scoreA += PIECE_VALUES[a.captured.type] * 10 - PIECE_VALUES[a.piece.type];
    }
    if (b.captured) {
      scoreB += PIECE_VALUES[b.captured.type] * 10 - PIECE_VALUES[b.piece.type];
    }
    if (a.promotion) scoreA += PIECE_VALUES[a.promotion];
    if (b.promotion) scoreB += PIECE_VALUES[b.promotion];
    if (a.isCastling) scoreA += 80;
    if (b.isCastling) scoreB += 80;

    return scoreB - scoreA;
  });
}

export function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  aiColor: Color,
  enPassant: Position | null,
  maxDepth: number
): number {
  const currentColor: Color = maximizing ? aiColor : aiColor === 'white' ? 'black' : 'white';
  const moves = getAllLegalMoves(board, currentColor, enPassant);

  if (moves.length === 0) {
    if (isInCheck(board, currentColor)) {
      return maximizing ? -99999 + (maxDepth - depth) : 99999 - (maxDepth - depth);
    }
    return 0;
  }

  if (depth === 0) {
    return evaluateBoard(board, aiColor);
  }

  const orderedMoves = orderMoves(moves);

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of orderedMoves) {
      const newBoard = cloneBoard(board);
      applyMoveToBoard(newBoard, move);
      const eval_ = minimax(newBoard, depth - 1, alpha, beta, false, aiColor, null, maxDepth);
      maxEval = Math.max(maxEval, eval_);
      alpha = Math.max(alpha, eval_);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of orderedMoves) {
      const newBoard = cloneBoard(board);
      applyMoveToBoard(newBoard, move);
      const eval_ = minimax(newBoard, depth - 1, alpha, beta, true, aiColor, null, maxDepth);
      minEval = Math.min(minEval, eval_);
      beta = Math.min(beta, eval_);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

// Fast position evaluation for coach suggestions
export function evaluatePosition(state: GameState, perspective: Color, depth = 2): number {
  const toMove = state.turn;
  const maximizing = toMove === perspective;
  const moves = getAllLegalMoves(state.board, toMove, state.enPassantTarget);

  if (moves.length === 0) {
    return isInCheck(state.board, toMove) ? (maximizing ? -9999 : 9999) : 0;
  }

  const ordered = orderMoves(moves);
  let best = maximizing ? -Infinity : Infinity;

  // Search top moves fast
  const candidates = ordered.slice(0, 12);
  for (const move of candidates) {
    const newBoard = cloneBoard(state.board);
    applyMoveToBoard(newBoard, move);
    const score = minimax(newBoard, depth - 1, -Infinity, Infinity, !maximizing, perspective, null, depth);
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
  }

  return best;
}

export function getBestMove(state: GameState, aiColor: Color, difficulty: AIDifficulty): Move | null {
  const config = DIFFICULTY_CONFIG[difficulty];
  const moves = getAllLegalMoves(state.board, aiColor, state.enPassantTarget);
  if (moves.length === 0) return null;

  // Occasional random blunder for beginner/amateur
  if (Math.random() < config.randomChance && moves.length > 1) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const orderedMoves = orderMoves(moves);
  let bestMove: Move | null = orderedMoves[0] || null;
  let bestScore = -Infinity;

  for (const move of orderedMoves) {
    const newBoard = cloneBoard(state.board);
    applyMoveToBoard(newBoard, move);

    const score = minimax(
      newBoard,
      config.depth - 1,
      -Infinity,
      Infinity,
      false,
      aiColor,
      null,
      config.depth
    );

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}
