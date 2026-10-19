import { GameState, Move, Color, PieceType, Position, Board } from './types';
import { makeMove, inBounds, isSquareAttacked } from './engine';
import { EngineMove } from './workerClient';

export interface CoachSuggestion {
  move: Move;
  notation: string;
  theme: string;
  hook: string;
  reasons: string[];
  proTip: string;
  score: number;
  scoreLabel: string;
  isMatingMove: boolean;
  /** Score of every legal move (centipawns, from the player's perspective). */
  scores: Record<string, number>;
}

export interface CoachFeedback {
  kind: 'followed' | 'deviated';
  title: string;
  text: string;
}

const FILES = 'abcdefgh';
const RANKS = '87654321';

const PIECE_NAMES: Record<PieceType, string> = {
  pawn: 'pawn',
  knight: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  queen: 'queen',
  king: 'king',
};

const PIECE_POINTS: Record<PieceType, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

const CENTER_SQUARES = ['d4', 'd5', 'e4', 'e5'];

export function squareName(pos: Position): string {
  return FILES[pos.col] + RANKS[pos.row];
}

export function nameToPosition(name: string): Position {
  return {
    col: FILES.indexOf(name[0]),
    row: RANKS.indexOf(name[1]),
  };
}

function pickRandom<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/** Human-friendly evaluation of the position from the player's point of view. */
export function scoreLabel(score: number): string {
  if (score >= 9000) return '🏆 Decisive winning advantage — go for the finish!';
  if (score <= -9000) return '🛡️ Critical position — you must fight back with active counterplay.';
  const p = score / 100;
  if (Math.abs(p) < 0.35) return '⚖️ Dead even balance — precise piece play will break the symmetry.';
  if (p > 0) {
    if (p >= 3.0) return `🔥 Clear dominance (+${p.toFixed(1)} pawns) — you are completely in control.`;
    return `📈 Modest advantage (+${p.toFixed(1)} pawns) — keep squeezing.`;
  }
  if (Math.abs(p) >= 3.0) return `⚠️ Your opponent leads by ${Math.abs(p).toFixed(1)} — hunt for tactical chances.`;
  return `⚔️ Slight deficit (-${Math.abs(p).toFixed(1)}) — stay solid and wait for their mistake.`;
}

/** Converts an engine move into the app's Move shape. */
export function engineMoveToMove(state: GameState, engineMove: EngineMove): Move {
  const from = nameToPosition(engineMove.from);
  const to = nameToPosition(engineMove.to);
  const piece = state.board[from.row][from.col]!;
  const captured = state.board[to.row][to.col] || undefined;

  return {
    from,
    to,
    piece,
    captured,
    isEnPassant: engineMove.isEnPassant,
    isCastling: engineMove.isCastling,
    promotion: engineMove.promo as PieceType | undefined,
  };
}

/** Detects a fork (one piece attacking two valuable targets at once). */
function checkFork(board: Board, move: Move, playerColor: Color): string | null {
  const opponent: Color = playerColor === 'white' ? 'black' : 'white';
  const targetPos = move.to;
  const attackedPieces: PieceType[] = [];

  if (move.piece.type === 'knight') {
    const offsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (const [dr, dc] of offsets) {
      const r = targetPos.row + dr;
      const c = targetPos.col + dc;
      if (inBounds(r, c)) {
        const p = board[r][c];
        if (
          p &&
          p.color === opponent &&
          (p.type === 'queen' || p.type === 'king' || p.type === 'rook' || p.type === 'bishop')
        ) {
          attackedPieces.push(p.type);
        }
      }
    }
  } else if (move.piece.type === 'pawn') {
    const pDir = playerColor === 'white' ? 1 : -1;
    for (const dc of [-1, 1]) {
      const r = targetPos.row + pDir;
      const c = targetPos.col + dc;
      if (inBounds(r, c)) {
        const p = board[r][c];
        if (p && p.color === opponent && p.type !== 'pawn') {
          attackedPieces.push(p.type);
        }
      }
    }
  }

  if (attackedPieces.length >= 2) {
    return `Double attack! The ${move.piece.type} forks the opponent's ${attackedPieces[0]} and ${attackedPieces[1]} at the same time.`;
  }
  return null;
}

/** True when the captured piece was completely undefended. */
function isUndefendedCapture(state: GameState, move: Move): boolean {
  if (!move.captured) return false;
  const opponent: Color = move.piece.color === 'white' ? 'black' : 'white';
  return !isSquareAttacked(state.board, move.to, opponent);
}

/** True when the moved piece was under attack and now is not. */
function isEscapingAttack(state: GameState, move: Move): boolean {
  const opponent: Color = move.piece.color === 'white' ? 'black' : 'white';
  const wasAttacked = isSquareAttacked(state.board, move.from, opponent);
  const nowSafe = !isSquareAttacked(state.board, move.to, opponent);
  return wasAttacked && nowSafe;
}

/**
 * Builds the full Grandmaster-style coaching breakdown for a move.
 * All heavy lifting (the search) already happened in the worker.
 */
export function buildCoachSuggestion(
  state: GameState,
  engineMove: EngineMove,
  engineScore: number,
  scores: Record<string, number>
): CoachSuggestion | null {
  const move = engineMoveToMove(state, engineMove);
  const next = makeMove(state, move);

  const notation =
    next.moveHistory[next.moveHistory.length - 1]?.notation ||
    `${engineMove.from}–${engineMove.to}`;

  const isMatingMove = next.status === 'checkmate';
  const score = isMatingMove ? 10000 : engineScore;
  const analysis = buildDynamicAnalysis(state, move, next, score);

  return {
    move,
    notation,
    theme: analysis.theme,
    hook: analysis.hook,
    reasons: analysis.reasons,
    proTip: analysis.proTip,
    score,
    scoreLabel: scoreLabel(score),
    isMatingMove,
    scores,
  };
}

function buildDynamicAnalysis(
  state: GameState,
  move: Move,
  next: GameState,
  score: number
): { theme: string; hook: string; reasons: string[]; proTip: string } {
  const toSq = squareName(move.to);
  const fromSq = squareName(move.from);
  const pieceName = PIECE_NAMES[move.piece.type];
  const capitalizedPiece = pieceName.charAt(0).toUpperCase() + pieceName.slice(1);
  const wasInCheck = state.status === 'check';
  const isDeliveringCheck = next.status === 'check' || next.status === 'checkmate';
  const playerColor = move.piece.color;

  const forkReason = checkFork(next.board, move, playerColor);
  const undefended = isUndefendedCapture(state, move);
  const escaping = isEscapingAttack(state, move);
  const scoreText = ` (${(score / 100).toFixed(1)} pawns)`;

  // 1. CHECKMATE
  if (next.status === 'checkmate') {
    return {
      theme: '👑 Royal Checkmate',
      hook: pickRandom([
        'Game over — this is the killing blow.',
        'Total victory, sealed right here on the board!',
        'You have engineered an inescapable mating net.',
      ]),
      reasons: [
        `Moving your ${pieceName} from ${fromSq} to ${toSq} places the enemy King in check with no escape.`,
        'Every adjacent square is either attacked by your pieces or blocked by their own pawns, and no piece can capture your attacker.',
        'In chess terms this is checkmate — the game ends immediately with a win.',
      ],
      proTip: '🎉 Well played! You calculated the whole mating sequence before committing. This is how tournament chess is won.',
    };
  }

  // 2. FORK
  if (forkReason) {
    return {
      theme: '⚡ Devastating Fork',
      hook: pickRandom([
        'Spot this tactical thunderbolt:',
        'A textbook double-threat with enormous leverage:',
        'Fork incoming — your opponent simply cannot answer both threats:',
      ]),
      reasons: [
        forkReason,
        `Your ${pieceName} lands on ${toSq} and simultaneously attacks two different enemy pieces.`,
        'Your opponent can only save one of them, so you collect decisive material on the very next move.',
        `The evaluation confirms it: this move swings the position to roughly ${(score / 100).toFixed(1)} pawns in your favour.`,
      ],
      proTip: '💡 Master Tip: Before every move, look for pieces that attack two enemies at once. Forks are the single most common way to win material at every level.',
    };
  }

  // 3. FREE CAPTURE
  if (move.captured && undefended) {
    const capName = PIECE_NAMES[move.captured.type];
    const capPoints = PIECE_POINTS[move.captured.type];
    return {
      theme: `💎 Free ${capName.toUpperCase()} Capture`,
      hook: pickRandom([
        'Punish their oversight immediately:',
        'Your opponent left a piece completely hanging:',
        'Free material alert — take what is being offered:',
      ]),
      reasons: [
        `Your ${pieceName} simply takes the undefended ${capName} on ${toSq} — you gain ${capPoints} full points of material.`,
        'Nothing defends that piece, so there is no tactical price to pay. It is pure profit.',
        isDeliveringCheck
          ? 'The capture even comes with check, so your opponent is under pressure immediately.'
          : `From ${toSq} your ${pieceName} is completely safe and controls important squares.`,
      ],
      proTip: `💡 Master Tip: Before each of your moves, scan the whole board for "hanging" pieces. Free captures are the surest path to a win.`,
    };
  }

  // 4. CAPTURE (general / good trade)
  if (move.captured) {
    const capName = PIECE_NAMES[move.captured.type];
    const capPoints = PIECE_POINTS[move.captured.type];
    const myPoints = PIECE_POINTS[move.piece.type];

    if (capPoints > myPoints) {
      return {
        theme: `💰 Winning Material Trade (+${capPoints - myPoints})`,
        hook: pickRandom([
          'A favourable exchange that cements your lead:',
          'Trading up in value is the fastest road to victory:',
          'Excellent piece capture — you come out ahead:',
        ]),
        reasons: [
          `Trading your ${pieceName} (${myPoints} points) for their ${capName} (${capPoints} points) wins you ${capPoints - myPoints} net points of material.`,
          `Removing their ${capName} deletes an active defender and opens lines into their position.`,
          'Material advantages compound: with more material you can trade pieces and reach an easy endgame.',
        ],
        proTip: '💡 Master Tip: When you are ahead in material, start trading off the remaining enemy pieces — a simplified endgame is almost always winning.',
      };
    }

    return {
      theme: '⚔️ Sharp Tactical Capture',
      hook: pickRandom([
        'Clean, calculated capture on the active square:',
        'Eliminating an enemy piece to seize the initiative:',
        'An accurate trade that improves your whole setup:',
      ]),
      reasons: [
        `Your ${pieceName} removes the ${capName} from ${toSq}, deleting a piece that was defending enemy territory.`,
        `Your ${pieceName} now occupies the most active square in that sector of the board.`,
        isDeliveringCheck
          ? 'It comes with check, so your opponent has to spend a turn defending instead of counter-attacking.'
          : 'It forces your opponent onto the defensive and hands you the initiative.',
      ],
      proTip: '💡 Master Tip: After you capture, immediately ask which enemy squares just became weak now that the defender is gone.',
    };
  }

  // 5. GETTING OUT OF CHECK
  if (wasInCheck) {
    return {
      theme: '🛡️ King Safety — Escaping Check',
      hook: pickRandom([
        'Priority number one — neutralise the check efficiently:',
        'The cleanest, safest answer to their attack:',
        'Solid defensive work that repels the threat:',
      ]),
      reasons: [
        'Your King was under attack, and this is the most reliable way to resolve that danger.',
        move.piece.type === 'king'
          ? `The King steps to ${toSq}, away from every enemy line of attack.`
          : `Your ${pieceName} blocks the checking line on ${toSq} and challenges the attacker.`,
        'A clean escape lets you keep your material and your structure intact, and often creates a counter-threat.',
      ],
      proTip: '💡 Master Tip: When in check, look for a response that also attacks the checking piece — that is called a "counter-check" and it saves a tempo.',
    };
  }

  // 6. CASTLING
  if (move.isCastling) {
    const side = move.isCastling === 'kingside' ? 'Kingside (O-O)' : 'Queenside (O-O-O)';
    return {
      theme: `🏰 ${side} — King Fortress`,
      hook: pickRandom([
        'The cornerstone of classic Grandmaster strategy:',
        'Two enormous benefits in one single move:',
        'Shield your King and wake up your heavy artillery:',
      ]),
      reasons: [
        'Castling tucks your King safely behind an unbreakable pawn shield, far away from the open centre.',
        'At the same time it activates your Rook, which becomes a powerful long-range attacker down the open file.',
        'It clears the back rank so the King can escape along it later, and lets you open the centre without fear of discovered check.',
      ],
      proTip: '💡 Master Tip: In almost every game, castling within your first ten moves is the golden rule — uncastled Kings lose more games than any other mistake.',
    };
  }

  // 7. DELIVERING CHECK
  if (isDeliveringCheck) {
    return {
      theme: '⚡ Aggressive Check',
      hook: pickRandom([
        'Apply relentless pressure on their monarch:',
        'Force the enemy into an uncomfortable corner:',
        'A sharp check that completely disrupts their plans:',
      ]),
      reasons: [
        `Your ${pieceName} attacks ${toSq}, giving check and forcing an immediate reply.`,
        'Checks steal a tempo — your opponent spends a turn defending rather than building their own attack.',
        'Checks often expose weaknesses around the enemy King that you can exploit on your following moves.',
      ],
      proTip: '💡 Master Tip: Do not give isolated one-move checks. Bring a second attacker to the zone so the check becomes genuinely dangerous.',
    };
  }

  // 8. PROMOTION
  if (move.promotion) {
    return {
      theme: '👑 Pawn Promotes to Queen!',
      hook: pickRandom([
        'The ultimate pawn transformation:',
        'A pawn reaches the final rank and becomes a Queen:',
        'Game-deciding promotion, right now on the board:',
      ]),
      reasons: [
        `Your pawn reaches ${toSq} and is promoted into a Queen — an instant +9 point material swing.`,
        'An extra Queen completely overwhelms the opposing army and wins nearly every game on its own.',
        'Your new Queen combines instantly with your other pieces, and mates usually follow within a few moves.',
      ],
      proTip: '💡 Master Tip: In the endgame, escorting a passed pawn to the promotion square is your number one winning plan — trade pieces to make that happen.',
    };
  }

  // 9. ESCAPING A THREAT
  if (escaping) {
    return {
      theme: '🛡️ Tactical Rescue',
      hook: pickRandom([
        'Save your valuable piece from danger:',
        'Smart tactical retreat to a safer outpost:',
        'Do not let your opponent win this piece for free:',
      ]),
      reasons: [
        `Your ${pieceName} was under direct enemy fire on ${fromSq}, and this move takes it to safety on ${toSq}.`,
        'By refusing the capture you keep your army at full strength and deny your opponent any points.',
        `From ${toSq} the ${pieceName} still influences the game and can support your other pieces.`,
      ],
      proTip: '💡 Master Tip: After every opponent move, ask yourself "what is being attacked right now?" Moving attacked pieces out of danger is fundamental chess hygiene.',
    };
  }

  // 10. OPENING DEVELOPMENT
  if (
    !move.piece.hasMoved &&
    (move.piece.type === 'knight' || move.piece.type === 'bishop')
  ) {
    return {
      theme: `🚀 Rapid ${capitalizedPiece} Development`,
      hook: pickRandom([
        'Classic opening principle in action:',
        'Bring your minor pieces into the battle early:',
        'Grandmaster opening rule: develop with purpose:',
      ]),
      reasons: [
        `Mobilises your ${pieceName} from its starting home on ${fromSq} into active duty on ${toSq}.`,
        `From ${toSq} it controls the vital central squares (${CENTER_SQUARES.join(', ')}) where the real battle will be decided.`,
        'It also clears the back rank so you can castle safely on a later move.',
      ],
      proTip: '💡 Master Tip: "Knights before Bishops" and "develop toward the centre" are the two opening rules every world champion follows without exception.',
    };
  }

  // 11. CENTRE PAWN
  if (move.piece.type === 'pawn' && (CENTER_SQUARES.includes(toSq) || toSq === 'c4' || toSq === 'c5')) {
    return {
      theme: '🎯 Claiming the Centre',
      hook: pickRandom([
        'Stake your claim on the high ground:',
        'The centre is where chess games are actually won:',
        'Open up your diagonals and dominate the board:',
      ]),
      reasons: [
        `Plants your pawn firmly on ${toSq}, claiming critical central space and squeezing your opponent's pieces.`,
        'It opens the diagonal highways so your Bishops and Queen can develop straight into the game.',
        'It denies your opponent\'s Knights comfortable landing squares in your half of the board.',
      ],
      proTip: '💡 Master Tip: Whoever controls the four central squares controls the easiest routes to attack everywhere on the board. It is the first thing to fight for.',
    };
  }

  // 12. ROOK ON A KEY FILE
  if (move.piece.type === 'rook' && 'cdef'.includes(toSq[0])) {
    return {
      theme: '⚡ Rook on the Open File',
      hook: pickRandom([
        'Put your heavy artillery on the main highway:',
        'Rooks belong on open files — textbook play:',
        'Maximise your Rook\'s vertical firepower:',
      ]),
      reasons: [
        `Stations your Rook on the ${toSq[0]}-file, where it commands the entire vertical column of the board.`,
        'From there it eyes the enemy pawns and the seventh rank, where pawns and Kings become vulnerable.',
        'It coordinates with your other pieces for combined pressure straight down the centre.',
      ],
      proTip: '💡 Master Tip: A Rook on an open file is nearly as valuable as a Queen because it controls every square on that file.',
    };
  }

  // 13. STRATEGIC IMPROVEMENT (default)
  return {
    theme: '🧠 Strategic Piece Improvement',
    hook: pickRandom([
      'Positional mastery — improving your least active piece:',
      'Strengthening the coordination of your whole army:',
      'A patient, high-IQ Grandmaster move:',
    ]),
    reasons: [
      `Transfers your ${pieceName} from ${fromSq} to a far more active, commanding square on ${toSq}.`,
      'It solidifies your pawn structure and keeps enemy infiltration routes firmly closed.',
      `With the whole army better coordinated the position is worth about ${scoreText.replace(/^ \(/, '').replace(/\)$/, '')} to you.`,
    ],
    proTip: '💡 Master Tip: When no tactic is available, find your least active piece and move it to a square where it controls more space and supports your others.',
  };
}

/**
 * Varied, natural feedback comparing the player's move with the coach's pick.
 * Uses the per-move scores the engine already computed — instant feedback.
 */
export function compareWithSuggestion(
  playerNotation: string,
  playerScore: number,
  bestNotation: string,
  bestScore: number
): CoachFeedback {
  const diff = playerScore - bestScore;

  // Equally strong or better
  if (diff >= -25) {
    const praises = [
      {
        title: '🔥 Brilliant Alternative!',
        text: `You played ${playerNotation}. That is just as strong as the coach's pick (${bestNotation}) — sharp, independent vision!`,
      },
      {
        title: '👑 Grandmaster Instincts!',
        text: `Superb judgement! ${playerNotation} keeps complete control of the position and your idea was fully sound.`,
      },
      {
        title: '⭐ Master-Level Execution!',
        text: `Spot on! Playing ${playerNotation} maintained maximum pressure on your opponent — exactly the right idea.`,
      },
      {
        title: '🎯 A Real Eye for the Game!',
        text: `Excellent choice (${playerNotation}). You matched the top engine evaluation with your own tactical idea.`,
      },
    ];
    return { kind: 'followed', ...pickRandom(praises) };
  }

  // Slightly inaccurate
  if (diff >= -120) {
    const mild = [
      {
        title: '👍 Decent Move, Slightly Inaccurate',
        text: `You chose ${playerNotation}. It is perfectly playable, but the coach's ${bestNotation} was a little sharper.`,
      },
      {
        title: '⚖️ Solid Try',
        text: `You went with ${playerNotation}. Safe, but ${bestNotation} would have created more active attacking chances.`,
      },
      {
        title: '🧐 Good Effort',
        text: `Playing ${playerNotation} holds the position together. Have a look at why ${bestNotation} exerted more pressure.`,
      },
    ];
    return { kind: 'deviated', ...pickRandom(mild) };
  }

  // Missed tactic
  const lost = (Math.abs(diff) / 100).toFixed(1);
  const warnings = [
    {
      title: '⚠️ Missed Tactical Opportunity',
      text: `You played ${playerNotation} — that is about ${lost} pawns weaker than the coach's ${bestNotation}. The reason: the recommended move attacks something you could have won.`,
    },
    {
      title: '💡 Learning Moment',
      text: `Your move ${playerNotation} gives up roughly ${lost} pawns of value. Next time, hunt for ${bestNotation} — it punishes the opponent's weakness straight away.`,
    },
    {
      title: '🛡️ A Sharper Move Was Available',
      text: `You played ${playerNotation}. Notice that ${bestNotation} would have dominated the board and turned the position into a clear winning advantage.`,
    },
  ];
  return { kind: 'deviated', ...pickRandom(warnings) };
}
