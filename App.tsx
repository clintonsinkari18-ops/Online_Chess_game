import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  createInitialGameState,
  makeMove,
  getLegalMoves,
  getCapturedPieces,
} from './chess/engine';
import { GameState, Move, Position, Color, PieceType, PIECE_SYMBOLS, Piece } from './chess/types';
import { AIDifficulty } from './chess/ai';
import {
  buildCoachSuggestion,
  compareWithSuggestion,
  engineMoveToMove,
  CoachSuggestion,
  CoachFeedback,
} from './chess/coach';
import { engineClient } from './chess/workerClient';
import PromotionDialog from './components/PromotionDialog';
import CoachPanel from './components/CoachPanel';
import { useTheme } from './context/ThemeContext';
import { soundManager } from './sounds/SoundManager';
import {
  RotateCcw, Users, Bot, ChevronDown, ChevronUp,
  Crown, Swords, History, Sparkles,
  ArrowRightLeft, Sun, Moon, User, Brain, Trophy,
  Volume2, VolumeX, GraduationCap, Settings, ShieldAlert, Radio
} from 'lucide-react';
import OnlineRoomPanel from './components/OnlineRoomPanel';
import { useOnlineRoom } from './online/useOnlineRoom';

type GameMode = 'pvp' | 'white' | 'black' | 'online';
type MobileTab = 'coach' | 'moves' | 'controls' | 'captures';

const FILES = 'abcdefgh';
const RANKS = '87654321';

const PIECE_VALUES: Record<PieceType, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

/**
 * Engine configuration per difficulty.
 * `depth`     – maximum search depth
 * `timeLimit` – hard wall-clock budget in ms (the engine stops cleanly)
 * `randomChance` – probability of a deliberate weaker move (lower levels)
 * `thinkDelay` – pleasant human-like pause before the AI piece visibly moves
 */
const AI_ENGINE_CONFIG: Record<
  AIDifficulty,
  { depth: number; timeLimit: number; randomChance: number; thinkDelay: number }
> = {
  beginner: { depth: 2, timeLimit: 90, randomChance: 0.28, thinkDelay: 700 },
  amateur: { depth: 4, timeLimit: 130, randomChance: 0.09, thinkDelay: 800 },
  professional: { depth: 6, timeLimit: 180, randomChance: 0.02, thinkDelay: 950 },
  superstar: { depth: 9, timeLimit: 260, randomChance: 0, thinkDelay: 1100 },
};

/** The coach always plays at full strength so its advice is trustworthy. */
const COACH_ENGINE_DEPTH = 9;
const COACH_ENGINE_TIME_LIMIT = 220;

function posToSquare(pos: Position): string {
  return FILES[pos.col] + RANKS[pos.row];
}

function squareToPos(sq: string): Position {
  return {
    col: FILES.indexOf(sq[0]),
    row: RANKS.indexOf(sq[1]),
  };
}

/* ─── Confetti Component ─── */
function Confetti({ active }: { active: boolean }) {
  if (!active) return null;
  const pieces = ['♔', '♕', '♖', '♗', '♘', '♙', '♚', '♛', '♜', '♝', '♞', '♟'];
  const colors = ['#fbbf24', '#f472b6', '#60a5fa', '#34d399', '#a78bfa', '#f87171'];
  return (
    <div className="fixed inset-0 pointer-events-none z-[60] overflow-hidden">
      {Array.from({ length: 36 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute text-lg select-none"
          initial={{
            x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 800),
            y: -30,
            rotate: 0,
            opacity: 1,
          }}
          animate={{
            y: typeof window !== 'undefined' ? window.innerHeight + 50 : 900,
            rotate: Math.random() * 720 - 360,
            opacity: 0,
          }}
          transition={{
            duration: 2 + Math.random() * 1.8,
            delay: Math.random() * 0.4,
            ease: 'easeIn',
          }}
          style={{ color: colors[i % colors.length] }}
        >
          {pieces[i % pieces.length]}
        </motion.div>
      ))}
    </div>
  );
}

/* ─── Main App ─── */
export default function App() {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';
  const online = useOnlineRoom();

  /* Game state */
  const [gameState, setGameState] = useState<GameState>(createInitialGameState);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  const [promotionSquare, setPromotionSquare] = useState<string | null>(null);
  const [promotionFrom, setPromotionFrom] = useState<string | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('room')
      ? 'online'
      : 'pvp'
  );
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('amateur');
  const [isFlipped, setIsFlipped] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSendingOnlineMove, setIsSendingOnlineMove] = useState(false);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isIslandExpanded, setIsIslandExpanded] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showDifficultyMenu, setShowDifficultyMenu] = useState(false);
  const [whiteName, setWhiteName] = useState('White');
  const [blackName, setBlackName] = useState('Black');
  const [onlinePlayerName, setOnlinePlayerName] = useState('Player');
  const [flashSquares, setFlashSquares] = useState<string[]>([]);
  const [boardShake, setBoardShake] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [animatingPiece, setAnimatingPiece] = useState<{
    from: Position;
    to: Position;
    piece: Piece;
    id: number;
  } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => soundManager.isSoundEnabled());
  const [coachEnabled, setCoachEnabled] = useState(true);
  const [coachSuggestion, setCoachSuggestion] = useState<CoachSuggestion | null>(null);
  const [coachThinking, setCoachThinking] = useState(false);
  const [coachFeedback, setCoachFeedback] = useState<CoachFeedback | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('room')
      ? 'controls'
      : 'coach'
  );

  const animIdRef = useRef(0);
  const historyRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const turn = gameState.turn;
  const inCheck = gameState.status === 'check' || gameState.status === 'checkmate';
  const isCheckmate = gameState.status === 'checkmate';
  const isStalemate = gameState.status === 'stalemate';
  const isDraw = gameState.status === 'draw';
  const isGameOver = isCheckmate || isStalemate || isDraw;

  const playerColor: Color | null = gameMode === 'online'
    ? online.room?.color ?? null
    : gameMode === 'white'
      ? 'white'
      : gameMode === 'black'
        ? 'black'
        : null;
  const isPlayersTurn = gameMode !== 'pvp' && playerColor !== null && turn === playerColor && !isGameOver;
  const isOnlineReady = Boolean(
    online.room?.connected && online.room.opponentConnected && online.room.opponentSynced
  );

  const whiteDisplayName = gameMode === 'online'
    ? online.room?.color === 'white'
      ? online.room.playerName
      : online.room?.opponentName || 'White'
    : gameMode === 'pvp'
      ? whiteName
      : gameMode === 'white'
        ? whiteName || 'You'
        : getAiName();
  const blackDisplayName = gameMode === 'online'
    ? online.room?.color === 'black'
      ? online.room.playerName
      : online.room?.opponentName || 'Black'
    : gameMode === 'pvp'
      ? blackName
      : gameMode === 'black'
        ? blackName || 'You'
        : getAiName();

  const status = isCheckmate
    ? `${turn === 'white' ? blackDisplayName : whiteDisplayName} wins by checkmate!`
    : isStalemate
    ? 'Stalemate — Draw'
    : isDraw
    ? 'Draw game'
    : gameMode === 'online' && !online.room
    ? 'Create or join an online room'
    : gameMode === 'online' && !isOnlineReady
    ? !online.room?.connected
      ? 'Connecting to online room'
      : !online.room.opponentConnected
        ? 'Waiting for your opponent to connect'
        : 'Syncing the board with your opponent'
    : gameMode === 'online' && isSendingOnlineMove
    ? 'Sending your move…'
    : inCheck
    ? `${turn === 'white' ? whiteDisplayName : blackDisplayName} is in Check!`
    : `${turn === 'white' ? whiteDisplayName : blackDisplayName}'s turn`;

  function getAiName() {
    const names: Record<AIDifficulty, string> = {
      beginner: 'AI (Beginner)',
      amateur: 'AI (Amateur)',
      professional: 'AI (Pro)',
      superstar: 'AI (Superstar)',
    };
    return names[aiDifficulty];
  }

  const statusColor = isCheckmate
    ? 'text-rose-500'
    : isStalemate || isDraw
    ? 'text-amber-500'
    : inCheck
    ? 'text-rose-500'
    : turn === 'white'
    ? isLight ? 'text-slate-800' : 'text-white'
    : isLight ? 'text-slate-600' : 'text-zinc-300';

  const captured = getCapturedPieces(gameState);

  /* Sound unlock on initial user interaction */
  useEffect(() => {
    const handleFirstInteraction = () => {
      soundManager.unlock();
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
    window.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    window.addEventListener('keydown', handleFirstInteraction, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, []);

  /* Sync sound manager preference */
  useEffect(() => {
    soundManager.setSoundEnabled(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    online.updateSnapshot(gameState, whiteDisplayName, blackDisplayName);
  }, [gameState, online.updateSnapshot, whiteDisplayName, blackDisplayName]);

  useEffect(() => {
    if (!online.snapshot || gameMode !== 'online') return;
    setGameState(online.snapshot.state);
    setWhiteName(online.snapshot.whiteName);
    setBlackName(online.snapshot.blackName);
    const last = online.snapshot.state.moveHistory.at(-1);
    setLastMove(last ? { from: posToSquare(last.from), to: posToSquare(last.to) } : null);
    void online.acknowledgeSnapshot();
  }, [online.snapshot, gameMode, online.acknowledgeSnapshot]);

  useEffect(() => {
    if (!online.incomingReset || gameMode !== 'online') return;
    setGameState(createInitialGameState());
    setSelectedSquare(null);
    setLegalMoves([]);
    setLastMove(null);
    setCoachFeedback(null);
    online.clearIncomingReset(online.incomingReset.id);
  }, [online.incomingReset, gameMode, online.clearIncomingReset]);

  /* Scroll history to bottom */
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [gameState.moveHistory]);

  useEffect(() => {
    const remote = online.incomingMove;
    const room = online.room;
    if (!remote) return;
    if (gameMode !== 'online' || !room) {
      online.clearIncomingMove(remote.id);
      return;
    }
    if (remote.color === room.color) {
      online.clearIncomingMove(remote.id);
      return;
    }
    if (remote.color !== gameState.turn) {
      online.reportError('The room received a move out of turn. Please rejoin if the board does not resync.');
      online.clearIncomingMove(remote.id);
      return;
    }

    const from = squareToPos(remote.from);
    const to = squareToPos(remote.to);
    const move = getLegalMoves(gameState.board, from, gameState.enPassantTarget).find(
      (candidate) =>
        candidate.to.row === to.row &&
        candidate.to.col === to.col &&
        candidate.promotion === remote.promotion
    );
    if (!move) {
      online.reportError('The opponent move could not be validated. Try leaving and rejoining the room.');
      online.clearIncomingMove(remote.id);
      return;
    }

    const next = makeMove(gameState, move);
    triggerPieceAnimation(move.from, move.to, move.piece);
    setGameState(next);
    setLastMove({ from: remote.from, to: remote.to });
    flashMove(remote.from, remote.to, Boolean(move.captured));
    if (soundEnabled) {
      if (next.status === 'checkmate') soundManager.playCheckmateSound();
      else if (next.status === 'check') soundManager.playCheckSound();
      else if (move.isCastling || move.promotion) soundManager.playSpecialMoveSound();
      else if (move.captured) soundManager.playCaptureSound();
      else soundManager.playMoveSound();
    }
    online.clearIncomingMove(remote.id);
  }, [online.incomingMove, online.room, gameMode, gameState, soundEnabled, online.clearIncomingMove, online.reportError]);

  /* Board shake on check */
  useEffect(() => {
    if (inCheck && !isCheckmate) {
      setBoardShake(true);
      const t = setTimeout(() => setBoardShake(false), 450);
      return () => clearTimeout(t);
    }
  }, [inCheck, isCheckmate, gameState.moveHistory.length]);

  /* Victory celebration */
  useEffect(() => {
    if (isCheckmate) {
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 4000);
      return () => clearTimeout(t);
    }
  }, [isCheckmate]);

  /* ── AI opponent: search runs in a Web Worker, so the UI never blocks ── */
  useEffect(() => {
    if (
      gameMode === 'pvp' ||
      isGameOver ||
      !((gameMode === 'white' && turn === 'black') || (gameMode === 'black' && turn === 'white'))
    ) {
      return;
    }

    let cancelled = false;
    const aiSide: 'white' | 'black' = gameMode === 'white' ? 'black' : 'white';
    const config = AI_ENGINE_CONFIG[aiDifficulty];
    const stateSnapshot = gameState;

    setIsThinking(true);

    const run = async () => {
      try {
        // Engine searches off the main thread — the UI stays alive while it thinks.
        const result = await engineClient.searchAI(
          stateSnapshot,
          aiSide,
          config.depth,
          config.timeLimit,
          config.randomChance
        );
        if (cancelled || !result.move) return;

        // A pleasant, human-like pause so the AI's move is actually watchable.
        await new Promise((r) => setTimeout(r, config.thinkDelay));
        if (cancelled) return;

        const move = engineMoveToMove(stateSnapshot, result.move);
        const fromSq = result.move.from;
        const toSq = result.move.to;

        triggerPieceAnimation(move.from, move.to, move.piece);
        const newState = makeMove(stateSnapshot, move);
        if (cancelled) return;
        setGameState(newState);
        setLastMove({ from: fromSq, to: toSq });
        flashMove(fromSq, toSq, !!move.captured);

        if (soundEnabled) {
          if (newState.status === 'checkmate') {
            soundManager.playCheckmateSound();
          } else if (newState.status === 'check') {
            soundManager.playCheckSound();
          } else if (move.isCastling || move.promotion) {
            soundManager.playSpecialMoveSound();
          } else if (move.captured) {
            soundManager.playCaptureSound();
          } else {
            soundManager.playMoveSound();
          }
        }
      } catch (err) {
        console.warn('AI search failed:', err);
      } finally {
        if (!cancelled) setIsThinking(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [gameState, gameMode, turn, isGameOver, aiDifficulty, soundEnabled]);

  /* ── Learning coach: analysis runs in the Web Worker (non-blocking) ── */
  useEffect(() => {
    if (!coachEnabled || !playerColor || isGameOver || turn !== playerColor) {
      setCoachThinking(false);
      return;
    }

    let cancelled = false;
    const side: 'white' | 'black' = playerColor;
    const stateSnapshot = gameState;

    setCoachThinking(true);

    const run = async () => {
      try {
        const result = await engineClient.analyzeCoach(
          stateSnapshot,
          side,
          COACH_ENGINE_DEPTH,
          COACH_ENGINE_TIME_LIMIT
        );
        if (cancelled || !result.move) {
          if (!cancelled) setCoachThinking(false);
          return;
        }
        const suggestion = buildCoachSuggestion(
          stateSnapshot,
          result.move,
          result.score,
          result.scores
        );
        if (!cancelled) {
          setCoachSuggestion(suggestion);
          setCoachThinking(false);
        }
      } catch (err) {
        console.warn('Coach analysis failed:', err);
        if (!cancelled) setCoachThinking(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [gameState, playerColor, coachEnabled, isGameOver, turn]);

  function triggerPieceAnimation(from: Position, to: Position, piece: Piece) {
    animIdRef.current += 1;
    setAnimatingPiece({ from, to, piece, id: animIdRef.current });
    // Hold the ghost a touch longer so every move is clearly visible
    setTimeout(() => {
      setAnimatingPiece((p) => (p?.id === animIdRef.current ? null : p));
    }, 420);
  }

  function flashMove(from: string, to: string, _isCapture: boolean) {
    setFlashSquares([from, to]);
    const t = setTimeout(() => setFlashSquares([]), 500);
    return () => clearTimeout(t);
  }

  const getSquareInfo = (sq: string) => {
    const pos = squareToPos(sq);
    return gameState.board[pos.row][pos.col];
  };

  const commitPlayerMove = useCallback((move: Move, fromSquare: string, toSquare: string) => {
    const commit = () => {
      const next = makeMove(gameState, move);
      triggerPieceAnimation(move.from, move.to, move.piece);
      setGameState(next);
      setLastMove({ from: fromSquare, to: toSquare });
      flashMove(fromSquare, toSquare, Boolean(move.captured));

      if (soundEnabled) {
        if (next.status === 'checkmate') soundManager.playCheckmateSound();
        else if (next.status === 'check') soundManager.playCheckSound();
        else if (move.isCastling || move.promotion) soundManager.playSpecialMoveSound();
        else if (move.captured) soundManager.playCaptureSound();
        else soundManager.playMoveSound();
      }

      if (coachEnabled && coachSuggestion && playerColor) {
        const followed =
          move.from.row === coachSuggestion.move.from.row &&
          move.from.col === coachSuggestion.move.from.col &&
          move.to.row === coachSuggestion.move.to.row &&
          move.to.col === coachSuggestion.move.to.col;
        const notation = next.moveHistory[next.moveHistory.length - 1]?.notation || '';
        const playedScore = coachSuggestion.scores[`${fromSquare}${toSquare}`];
        setCoachFeedback(
          followed
            ? {
                kind: 'followed',
                title: move.promotion ? '👑 Promotion on target!' : '🔥 Masterful Choice!',
                text: `You played the coach's recommendation, ${notation}. Keep building on that advantage.`,
              }
            : compareWithSuggestion(
                notation,
                playedScore ?? coachSuggestion.score,
                coachSuggestion.notation,
                coachSuggestion.score
              )
        );
      }
      setSelectedSquare(null);
      setLegalMoves([]);
    };

    if (gameMode !== 'online') {
      commit();
      return;
    }

    if (!isOnlineReady || !online.room || online.room.color !== move.piece.color) {
      online.reportError('Wait until your opponent is connected before moving.');
      return;
    }

    setIsSendingOnlineMove(true);
    void online.sendMove(move)
      .then((sent) => {
        if (!sent) {
          online.reportError('Your move could not be sent. Check your connection and retry.');
          return;
        }
        commit();
      })
      .catch(() => online.reportError('Connection lost while sending your move.'))
      .finally(() => setIsSendingOnlineMove(false));
  }, [gameState, soundEnabled, coachEnabled, coachSuggestion, playerColor, gameMode, isOnlineReady, online.room, online.sendMove, online.reportError]);

  const handleSquareClick = useCallback(
    (square: string) => {
      if (isGameOver || isThinking || isSendingOnlineMove) return;
      if (gameMode === 'online' && (!isOnlineReady || turn !== playerColor)) return;
      if (gameMode !== 'pvp' && gameMode !== 'online' && ((gameMode === 'white' && turn === 'black') || (gameMode === 'black' && turn === 'white'))) return;

      const piece = getSquareInfo(square);
      const pos = squareToPos(square);

      if (selectedSquare) {
        if (selectedSquare === square) {
          setSelectedSquare(null);
          setLegalMoves([]);
          return;
        }
        const targetPos = squareToPos(square);
        const matchingMove = legalMoves.find(
          (m) => m.to.row === targetPos.row && m.to.col === targetPos.col
        );
        if (matchingMove) {
          if (matchingMove.promotion) {
            setPromotionFrom(selectedSquare);
            setPromotionSquare(square);
            setSelectedSquare(null);
            setLegalMoves([]);
            return;
          }
          commitPlayerMove(matchingMove, selectedSquare, square);
          return;
        }
        if (piece && piece.color === turn) {
          setSelectedSquare(square);
          const moves = getLegalMoves(gameState.board, pos, gameState.enPassantTarget);
          setLegalMoves(moves);
          return;
        }
        setSelectedSquare(null);
        setLegalMoves([]);
        return;
      }
      if (piece && piece.color === turn) {
        setSelectedSquare(square);
        const moves = getLegalMoves(gameState.board, pos, gameState.enPassantTarget);
        setLegalMoves(moves);
      }
    },
    [selectedSquare, legalMoves, isGameOver, isThinking, isSendingOnlineMove, isOnlineReady, playerColor, turn, gameState, gameMode, commitPlayerMove]
  );

  const handlePromotion = useCallback(
    (pieceType: PieceType) => {
      if (promotionFrom && promotionSquare) {
        const fromPos = squareToPos(promotionFrom);
        const toPos = squareToPos(promotionSquare);
        const legalPromotion = getLegalMoves(gameState.board, fromPos, gameState.enPassantTarget).find(
          (candidate) => candidate.to.row === toPos.row && candidate.to.col === toPos.col && candidate.promotion === pieceType
        );
        if (legalPromotion) commitPlayerMove(legalPromotion, promotionFrom, promotionSquare);
      }
      setPromotionFrom(null);
      setPromotionSquare(null);
    },
    [promotionFrom, promotionSquare, gameState, commitPlayerMove]
  );

  const resetGame = useCallback((syncOnline = false) => {
    if (syncOnline && gameMode === 'online') void online.sendReset();
    setGameState(createInitialGameState());
    setSelectedSquare(null);
    setLegalMoves([]);
    setLastMove(null);
    setShowConfirm(false);
    setIsThinking(false);
    setShowConfetti(false);
    setFlashSquares([]);
    setIsSendingOnlineMove(false);
    setCoachSuggestion(null);
    setCoachFeedback(null);
    setCoachThinking(false);
  }, [gameMode, online.sendReset]);

  const selectGameMode = useCallback((mode: GameMode) => {
    if (gameMode === 'online' && mode !== 'online') void online.leaveRoom();
    setGameMode(mode);
    resetGame(mode === 'online' && gameMode === 'online');
  }, [gameMode, online.leaveRoom, resetGame]);

  const createOnlineRoom = useCallback(async (name: string) => {
    setOnlinePlayerName(name.trim() || 'Player');
    setGameMode('online');
    resetGame();
    return online.createRoom(name);
  }, [online.createRoom, resetGame]);

  const joinOnlineRoom = useCallback(async (code: string, name: string) => {
    setOnlinePlayerName(name.trim() || 'Player');
    setGameMode('online');
    resetGame();
    return online.joinRoom(code, name);
  }, [online.joinRoom, resetGame]);

  const leaveOnlineRoom = useCallback(() => {
    void online.leaveRoom();
    setGameMode('pvp');
    resetGame();
  }, [online.leaveRoom, resetGame]);

  const getMaterialScore = (pieces: { type: PieceType }[]) => {
    return pieces.reduce((sum, p) => sum + (PIECE_VALUES[p.type] || 0), 0);
  };

  const whiteScore = getMaterialScore(captured.black);
  const blackScore = getMaterialScore(captured.white);
  const materialDiff = whiteScore - blackScore;

  const displayRanks = isFlipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const displayFiles = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  const getVisualPos = (pos: Position) => {
    if (isFlipped) return { row: pos.row, col: 7 - pos.col };
    return { row: 7 - pos.row, col: pos.col };
  };

  const getIslandIcon = () => {
    if (isCheckmate) return <Crown className="w-4 h-4 text-amber-500 animate-bounce" />;
    if (isStalemate || isDraw) return <Swords className="w-4 h-4 text-amber-500" />;
    if (inCheck) return <ShieldAlert className="w-4 h-4 text-rose-500 animate-pulse" />;
    if (isThinking || isSendingOnlineMove) return <Sparkles className="w-4 h-4 text-cyan-500 animate-spin" />;
    return (
      <div className={`w-2.5 h-2.5 rounded-full ${turn === 'white' 
        ? isLight ? 'bg-slate-800 shadow-[0_0_8px_rgba(0,0,0,0.3)]' : 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]' 
        : isLight ? 'bg-slate-400' : 'bg-zinc-500'}`} 
      />
    );
  };

  const difficultyLabels: Record<AIDifficulty, string> = {
    beginner: 'Beginner',
    amateur: 'Amateur',
    professional: 'Professional',
    superstar: 'Superstar',
  };

  const difficultyIcons: Record<AIDifficulty, React.ReactNode> = {
    beginner: <Brain className="w-3.5 h-3.5 text-emerald-400" />,
    amateur: <Brain className="w-3.5 h-3.5 text-cyan-400" />,
    professional: <Trophy className="w-3.5 h-3.5 text-amber-400" />,
    superstar: <Crown className="w-3.5 h-3.5 text-rose-400" />,
  };

  return (
    <div className={`min-h-screen w-full flex flex-col items-center px-2.5 sm:px-4 py-3 sm:py-5 relative transition-colors duration-500 ${isLight ? 'text-slate-800' : 'text-white'}`}>
      <Confetti active={showConfetti} />

      {/* Ambient background orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className={`absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full blur-[120px] orb-1 ${isLight ? 'bg-indigo-400/[0.05]' : 'bg-indigo-500/[0.03]'}`} />
        <div className={`absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full blur-[120px] orb-2 ${isLight ? 'bg-purple-400/[0.05]' : 'bg-purple-500/[0.03]'}`} />
        <div className={`absolute top-[40%] left-[50%] -translate-x-1/2 w-[30vw] h-[30vw] rounded-full blur-[100px] orb-3 ${isLight ? 'bg-cyan-400/[0.04]' : 'bg-cyan-500/[0.02]'}`} />
      </div>

      {/* Dynamic Island Header */}
      <motion.div 
        className="fixed top-2.5 sm:top-4 left-1/2 -translate-x-1/2 z-50 w-[92%] sm:w-auto max-w-md"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 350, damping: 26 }}
      >
        <motion.div
          layout
          className={`dynamic-island rounded-full flex items-center justify-between gap-2.5 px-3.5 sm:px-4 py-2 cursor-pointer transition-all duration-300 w-full sm:min-w-[190px]`}
          onClick={() => setIsIslandExpanded(!isIslandExpanded)}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            {getIslandIcon()}
            <span className={`text-xs sm:text-sm font-semibold truncate ${statusColor}`}>
              {isIslandExpanded ? status : status.split(' — ')[0]}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isIslandExpanded ? (
              <ChevronUp className={`w-3.5 h-3.5 ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
            ) : (
              <ChevronDown className={`w-3.5 h-3.5 ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
            )}
          </div>
        </motion.div>

        <AnimatePresence>
          {isIslandExpanded && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 450, damping: 30 }}
              className="dynamic-island rounded-2xl mt-1.5 p-3.5 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full glass flex items-center justify-center ${turn === 'white' ? 'ring-2 ring-emerald-400' : ''}`}>
                    <span className="text-sm">♙</span>
                  </div>
                  <div>
                    <div className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-white/40'}`}>{whiteDisplayName}</div>
                    <div className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-white'}`}>
                      {gameState.moveHistory.filter((_, i) => i % 2 === 0).length} moves
                    </div>
                  </div>
                </div>

                <div className={`text-xs font-bold uppercase tracking-wider ${isLight ? 'text-slate-300' : 'text-white/20'}`}>VS</div>

                <div className="flex items-center gap-2 text-right">
                  <div>
                    <div className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-white/40'}`}>{blackDisplayName}</div>
                    <div className={`text-xs font-bold ${isLight ? 'text-slate-700' : 'text-white'}`}>
                      {gameState.moveHistory.filter((_, i) => i % 2 === 1).length} moves
                    </div>
                  </div>
                  <div className={`w-7 h-7 rounded-full glass flex items-center justify-center ${turn === 'black' ? 'ring-2 ring-emerald-400' : ''}`}>
                    <span className="text-sm">♟</span>
                  </div>
                </div>
              </div>

              {isGameOver && (
                <div className="text-center py-1.5 px-3 rounded-xl glass bg-rose-500/10 border border-rose-500/20 text-xs font-bold text-rose-400">
                  {status}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Main Title Header */}
      <div className="mt-14 sm:mt-16 mb-2 sm:mb-4 text-center z-10">
        <h1 className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${isLight ? 'text-slate-800' : 'text-white/95'}`}>
          Liquid Glass
          <span className={`font-light ${isLight ? 'text-slate-400' : 'text-white/40'}`}> Chess</span>
        </h1>
      </div>

      {/* ─── Universal Responsive Layout Container ─── */}
      <div className="w-full max-w-[1240px] flex flex-col lg:flex-row items-center lg:items-start justify-center gap-3.5 lg:gap-5 z-10 pb-16 lg:pb-6">
        
        {/* ─── LEFT COLUMN (Desktop: Controls & Captures) ─── */}
        <div className="hidden lg:flex w-[260px] flex-col gap-3 order-1 shrink-0">
          {/* PvP Players */}
          {gameMode === 'pvp' && (
            <div className="glass-panel rounded-2xl p-3">
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${isLight ? 'text-slate-400' : 'text-white/40'}`}>Players</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${turn === 'white' ? 'bg-emerald-500/20 text-emerald-400' : isLight ? 'bg-slate-200' : 'bg-white/10'}`}>
                    <User className="w-3 h-3" />
                  </div>
                  <input
                    type="text"
                    value={whiteName}
                    onChange={(e) => setWhiteName(e.target.value || 'White')}
                    className={`flex-1 bg-transparent text-xs font-semibold outline-none border-b border-transparent focus:border-emerald-400/50 px-1 py-0.5 ${isLight ? 'text-slate-700' : 'text-white'}`}
                    placeholder="White name"
                    maxLength={14}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${turn === 'black' ? 'bg-emerald-500/20 text-emerald-400' : isLight ? 'bg-slate-200' : 'bg-white/10'}`}>
                    <User className="w-3 h-3" />
                  </div>
                  <input
                    type="text"
                    value={blackName}
                    onChange={(e) => setBlackName(e.target.value || 'Black')}
                    className={`flex-1 bg-transparent text-xs font-semibold outline-none border-b border-transparent focus:border-emerald-400/50 px-1 py-0.5 ${isLight ? 'text-slate-700' : 'text-white'}`}
                    placeholder="Black name"
                    maxLength={14}
                  />
                </div>
              </div>
            </div>
          )}

          {/* AI Mode Info */}
          {(gameMode === 'white' || gameMode === 'black') && (
            <div className="glass-panel rounded-2xl p-3">
              <div className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 ${isLight ? 'text-slate-400' : 'text-white/40'}`}>Computer Opponent</div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full glass flex items-center justify-center">
                  <Bot className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <div className={`text-xs font-bold ${isLight ? 'text-slate-800' : 'text-white'}`}>{getAiName()}</div>
                  <div className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-white/40'}`}>
                    Plays {gameMode === 'white' ? 'Black' : 'White'} • Fast Calculation
                  </div>
                </div>
              </div>
            </div>
          )}

          {gameMode === 'online' && (
            <OnlineRoomPanel
              room={online.room}
              configured={online.isConfigured}
              error={online.error}
              isLight={isLight}
              playerName={onlinePlayerName}
              onPlayerNameChange={setOnlinePlayerName}
              onCreate={createOnlineRoom}
              onJoin={joinOnlineRoom}
              onLeave={leaveOnlineRoom}
              onClearError={online.clearError}
            />
          )}

          {/* Captured Pieces Desktop */}
          <div className="glass-panel rounded-2xl p-3 space-y-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-400' : 'text-white/40'}`}>White Captures</span>
                {materialDiff > 0 && <span className="text-[10px] font-bold text-emerald-400">+{materialDiff}</span>}
              </div>
              <div className="flex flex-wrap gap-0.5 min-h-[22px] items-center">
                {captured.black.map((p, i) => (
                  <span key={i} className={`text-sm ${isLight ? 'text-slate-700' : 'text-white/80'}`}>{PIECE_SYMBOLS.black[p.type]}</span>
                ))}
                {captured.black.length === 0 && <span className={`text-[10px] italic ${isLight ? 'text-slate-300' : 'text-white/20'}`}>None</span>}
              </div>
            </div>

            <div className={`border-t pt-2 ${isLight ? 'border-black/5' : 'border-white/5'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-400' : 'text-white/40'}`}>Black Captures</span>
                {materialDiff < 0 && <span className="text-[10px] font-bold text-emerald-400">+{-materialDiff}</span>}
              </div>
              <div className="flex flex-wrap gap-0.5 min-h-[22px] items-center">
                {captured.white.map((p, i) => (
                  <span key={i} className={`text-sm ${isLight ? 'text-slate-700' : 'text-white/80'}`}>{PIECE_SYMBOLS.white[p.type]}</span>
                ))}
                {captured.white.length === 0 && <span className={`text-[10px] italic ${isLight ? 'text-slate-300' : 'text-white/20'}`}>None</span>}
              </div>
            </div>
          </div>

          {/* Game Settings & Controls Desktop */}
          <div className="glass-panel rounded-2xl p-3 space-y-2">
            {/* Game Mode Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowModeMenu(!showModeMenu)}
                className={`glass-button w-full rounded-xl px-3 py-2 flex items-center justify-between text-xs font-semibold ${isLight ? 'text-slate-700' : 'text-white/80'}`}
              >
                <span className="flex items-center gap-1.5">
                  {gameMode === 'pvp' ? <Users className="w-3.5 h-3.5" /> : gameMode === 'online' ? <Radio className="w-3.5 h-3.5 text-cyan-400" /> : <Bot className="w-3.5 h-3.5 text-cyan-400" />}
                  {gameMode === 'pvp' ? 'Player vs Player' : gameMode === 'online' ? 'Play Online' : gameMode === 'white' ? 'Play White vs AI' : 'Play Black vs AI'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showModeMenu ? 'rotate-180' : ''}`} />
              </button>
              {showModeMenu && (
                <div className="absolute top-full left-0 right-0 mt-1 glass-strong rounded-xl overflow-hidden z-30 shadow-xl">
                  {(['pvp', 'white', 'black', 'online'] as GameMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => { selectGameMode(mode); setShowModeMenu(false); }}
                      className={`w-full px-3 py-2 text-xs text-left flex items-center gap-2 transition-colors ${
                        gameMode === mode ? (isLight ? 'bg-black/5 font-bold' : 'bg-white/10 font-bold') : 'hover:bg-white/5 opacity-75'
                      }`}
                    >
                      {mode === 'pvp' ? <Users className="w-3.5 h-3.5" /> : mode === 'online' ? <Radio className="w-3.5 h-3.5 text-cyan-400" /> : <Bot className="w-3.5 h-3.5" />}
                      {mode === 'pvp' ? 'Player vs Player' : mode === 'online' ? 'Play Online' : mode === 'white' ? 'Play White vs AI' : 'Play Black vs AI'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* AI Difficulty Dropdown */}
            {(gameMode === 'white' || gameMode === 'black') && (
              <div className="relative">
                <button
                  onClick={() => setShowDifficultyMenu(!showDifficultyMenu)}
                  className={`glass-button w-full rounded-xl px-3 py-2 flex items-center justify-between text-xs font-semibold ${isLight ? 'text-slate-700' : 'text-white/80'}`}
                >
                  <span className="flex items-center gap-1.5">
                    {difficultyIcons[aiDifficulty]}
                    AI: {difficultyLabels[aiDifficulty]}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDifficultyMenu ? 'rotate-180' : ''}`} />
                </button>
                {showDifficultyMenu && (
                  <div className="absolute top-full left-0 right-0 mt-1 glass-strong rounded-xl overflow-hidden z-30 shadow-xl">
                    {(['beginner', 'amateur', 'professional', 'superstar'] as AIDifficulty[]).map((diff) => (
                      <button
                        key={diff}
                        onClick={() => { setAiDifficulty(diff); setShowDifficultyMenu(false); }}
                        className={`w-full px-3 py-2 text-xs text-left flex items-center gap-2 transition-colors ${
                          aiDifficulty === diff ? (isLight ? 'bg-black/5 font-bold' : 'bg-white/10 font-bold') : 'hover:bg-white/5 opacity-75'
                        }`}
                      >
                        {difficultyIcons[diff]}
                        {difficultyLabels[diff]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                onClick={() => setIsFlipped(!isFlipped)}
                className={`glass-button rounded-xl py-2 px-2.5 flex items-center justify-center gap-1.5 text-xs font-semibold ${isLight ? 'text-slate-700' : 'text-white/80'}`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" /> Flip
              </button>
              <button
                onClick={toggleTheme}
                className={`glass-button rounded-xl py-2 px-2.5 flex items-center justify-center gap-1.5 text-xs font-semibold ${isLight ? 'text-slate-700' : 'text-white/80'}`}
              >
                {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5 text-amber-400" />}
                {isLight ? 'Dark' : 'Light'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`glass-button rounded-xl py-2 px-2.5 flex items-center justify-center gap-1.5 text-xs font-semibold ${isLight ? 'text-slate-700' : 'text-white/80'}`}
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 opacity-50" />}
                {soundEnabled ? 'Sound ON' : 'Muted'}
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                className="glass-button rounded-xl py-2 px-2.5 flex items-center justify-center gap-1.5 text-xs font-semibold text-rose-400 border-rose-500/20 hover:bg-rose-500/10"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </button>
            </div>
          </div>
        </div>

        {/* ─── CENTER COLUMN: The Chess Board ─── */}
        <div className="flex flex-col items-center order-1 lg:order-2 shrink-0 w-full lg:w-auto">
          <motion.div
            ref={boardRef}
            className={`glass-strong rounded-2xl p-1.5 sm:p-2.5 md:p-3 relative shadow-2xl transition-transform ${boardShake ? 'animate-board-shake' : ''}`}
            style={{ width: 'min(94vw, 440px)', maxWidth: '520px' }}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
          >
            {/* Top file coordinates */}
            <div className="flex mb-0.5 sm:mb-1">
              <div className="w-3.5 sm:w-5" />
              {displayFiles.map((c) => (
                <div key={c} className={`flex-1 text-center text-[8px] sm:text-[10px] font-mono font-bold ${isLight ? 'text-slate-400' : 'text-white/30'}`}>
                  {FILES[c]}
                </div>
              ))}
            </div>

            <div className="flex relative">
              {/* Left rank coordinates */}
              <div className="flex flex-col mr-0.5 sm:mr-1">
                {displayRanks.map((r) => (
                  <div key={r} className="flex-1 flex items-center justify-center">
                    <span className={`text-[8px] sm:text-[10px] font-mono font-bold ${isLight ? 'text-slate-400' : 'text-white/30'}`}>{RANKS[r]}</span>
                  </div>
                ))}
              </div>

              {/* The 8x8 Grid */}
              <div className="grid grid-cols-8 grid-rows-8 relative w-full aspect-square rounded-lg overflow-hidden border border-white/10 shadow-inner">
                {displayRanks.map((rank) =>
                  displayFiles.map((file) => {
                    const sq = FILES[file] + RANKS[rank];
                    const piece = gameState.board[rank][file];
                    const isLightSquare = (rank + file) % 2 === 0;
                    const isSelected = selectedSquare === sq;

                    const isLegal = legalMoves.some((m) => m.to.row === rank && m.to.col === file);
                    const isCapture = isLegal && piece !== null;
                    const isLastMoveSquare = lastMove && (lastMove.from === sq || lastMove.to === sq);
                    const isCheckSquare = inCheck && piece?.type === 'king' && piece?.color === turn;

                    const isFlashing = flashSquares.includes(sq);
                    const isCaptureFlash = isFlashing && flashSquares[1] === sq && !getSquareInfo(flashSquares[0]);

                    const isCoachFrom =
                      coachEnabled && !!coachSuggestion && isPlayersTurn && !coachThinking &&
                      sq === posToSquare(coachSuggestion.move.from);
                    const isCoachTo =
                      coachEnabled && !!coachSuggestion && isPlayersTurn && !coachThinking &&
                      sq === posToSquare(coachSuggestion.move.to);

                    return (
                      <div
                        key={sq}
                        className={`relative flex items-center justify-center transition-colors duration-150 select-none ${
                          isSelected
                            ? 'bg-amber-400/35 ring-2 ring-amber-400/80 z-[3]'
                            : isLastMoveSquare
                            ? 'bg-emerald-400/20'
                            : isLightSquare
                            ? 'square-light-glass'
                            : 'square-dark-glass'
                        } ${isFlashing && !isCaptureFlash ? 'animate-square-flash' : ''} ${isCaptureFlash ? 'animate-capture-flash' : ''}`}
                        onClick={() => handleSquareClick(sq)}
                        style={{ cursor: isGameOver || isThinking ? 'default' : 'pointer' }}
                      >
                        {/* Legal move dot */}
                        {isLegal && !isCapture && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[4]">
                            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-emerald-400/70 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
                          </div>
                        )}

                        {/* Legal capture target ring */}
                        {isCapture && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[4]">
                            <div className="w-[85%] h-[85%] rounded-lg border-2 border-rose-400/80 shadow-[0_0_10px_rgba(244,63,94,0.5)] animate-ring-pulse" />
                          </div>
                        )}

                        {/* Check King Warning Glow */}
                        {isCheckSquare && (
                          <div className="absolute inset-0 bg-rose-500/35 animate-pulse-glow z-[2]" />
                        )}

                        {/* Coach Highlight: Move Origin Ring */}
                        {isCoachFrom && (
                          <div className="absolute inset-[1.5px] rounded-lg border-2 border-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.8)] animate-pulse pointer-events-none z-[3]" />
                        )}

                        {/* Coach Highlight: Move Destination Marker */}
                        {isCoachTo && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[4]">
                            <div className="w-3.5 h-3.5 rounded-full bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,1)] ring-2 ring-white/60 animate-ping" />
                          </div>
                        )}

                        {/* Chess Piece Symbol */}
                        {piece && (
                          <span
                            className={`text-[clamp(1.7rem,8vw,3.2rem)] leading-none transition-transform duration-100 ${
                              isSelected ? 'scale-110 drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]' : 'hover:scale-105'
                            }`}
                            style={{
                              filter:
                                piece.color === 'white'
                                  ? isLight 
                                    ? 'drop-shadow(0 0 2px rgba(0,0,0,0.25)) drop-shadow(1px 2px 2px rgba(0,0,0,0.2))'
                                    : 'drop-shadow(0 0 4px rgba(0,0,0,0.5)) drop-shadow(1px 2px 2px rgba(0,0,0,0.4))'
                                  : isLight
                                    ? 'drop-shadow(0 0 2px rgba(255,255,255,0.4)) drop-shadow(1px 2px 2px rgba(0,0,0,0.3))'
                                    : 'drop-shadow(0 0 4px rgba(255,255,255,0.2)) drop-shadow(1px 2px 2px rgba(0,0,0,0.6))',
                              color: piece.color === 'white' 
                                ? (isLight ? '#334155' : '#ffffff') 
                                : (isLight ? '#1e293b' : '#111827'),
                              textShadow:
                                piece.color === 'white'
                                  ? isLight ? '0 0 2px rgba(0,0,0,0.1)' : '0 0 3px rgba(0,0,0,0.6), 0 0 6px rgba(0,0,0,0.4)'
                                  : isLight ? '0 0 3px rgba(255,255,255,0.4)' : '0 0 3px rgba(255,255,255,0.3)',
                              zIndex: 2,
                            }}
                          >
                            {PIECE_SYMBOLS[piece.color][piece.type]}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}

                {/* Smooth Animated Piece Ghost */}
                <AnimatePresence>
                  {animatingPiece && (
                    <motion.div
                      className="absolute pointer-events-none z-50 flex items-center justify-center"
                      style={{
                        width: `${100 / 8}%`,
                        height: `${100 / 8}%`,
                      }}
                      initial={{
                        left: `${(getVisualPos(animatingPiece.from).col / 8) * 100}%`,
                        top: `${(getVisualPos(animatingPiece.from).row / 8) * 100}%`,
                        opacity: 1,
                      }}
                      animate={{
                        left: `${(getVisualPos(animatingPiece.to).col / 8) * 100}%`,
                        top: `${(getVisualPos(animatingPiece.to).row / 8) * 100}%`,
                        opacity: 0,
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 450, damping: 28 }}
                    >
                      <span className="text-[clamp(1.7rem,8vw,3.2rem)] leading-none">
                        {PIECE_SYMBOLS[animatingPiece.piece.color][animatingPiece.piece.type]}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Right rank coordinates */}
              <div className="flex flex-col ml-0.5 sm:ml-1">
                {displayRanks.map((r) => (
                  <div key={r} className="flex-1 flex items-center justify-center">
                    <span className={`text-[8px] sm:text-[10px] font-mono font-bold ${isLight ? 'text-slate-400' : 'text-white/30'}`}>{RANKS[r]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom file coordinates */}
            <div className="flex mt-0.5 sm:mt-1">
              <div className="w-3.5 sm:w-5" />
              {displayFiles.map((c) => (
                <div key={c} className={`flex-1 text-center text-[8px] sm:text-[10px] font-mono font-bold ${isLight ? 'text-slate-400' : 'text-white/30'}`}>
                  {FILES[c]}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Instant Thinking Indicator below board */}
          <AnimatePresence>
            {(isThinking || isSendingOnlineMove) && (
              <motion.div
                className="mt-2.5 flex items-center gap-2 glass rounded-full px-3.5 py-1.5 shadow-md"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                <span className={`text-xs font-semibold ${isLight ? 'text-slate-600' : 'text-white/80'}`}>
                  {isSendingOnlineMove ? 'Sending your move…' : `${getAiName()} thinking…`}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── RIGHT COLUMN (Desktop: Learning Coach & Move History) ─── */}
        <div className="hidden lg:flex w-[290px] xl:w-[310px] flex-col gap-3 order-3 shrink-0">
          {/* Coach Panel */}
          {gameMode !== 'pvp' && (
            <CoachPanel
              enabled={coachEnabled}
              onToggle={() => setCoachEnabled(!coachEnabled)}
              suggestion={coachSuggestion}
              isCoachThinking={coachThinking}
              isPlayersTurn={isPlayersTurn}
              isGameOver={isGameOver}
              gameOverText={status}
              feedback={coachFeedback}
              isLight={isLight}
            />
          )}

          {/* Move History */}
          <div className="glass-panel rounded-2xl overflow-hidden flex flex-col max-h-[280px]">
            <div className={`flex items-center gap-2 px-3.5 py-2.5 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
              <History className={`w-3.5 h-3.5 ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-600' : 'text-white/70'}`}>Move History</span>
              <span className={`ml-auto text-[10px] font-mono ${isLight ? 'text-slate-400' : 'text-white/40'}`}>
                {gameState.moveHistory.length} ply
              </span>
            </div>
            <div ref={historyRef} className="flex-1 overflow-y-auto custom-scroll p-2 text-xs">
              {gameState.moveHistory.length === 0 ? (
                <div className="text-center py-6 text-xs italic opacity-40">No moves made yet</div>
              ) : (
                <div className="space-y-1">
                  {Array.from({ length: Math.ceil(gameState.moveHistory.length / 2) }).map((_, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-mono ${
                        i === Math.ceil(gameState.moveHistory.length / 2) - 1 ? (isLight ? 'bg-black/5 font-bold' : 'bg-white/10 font-bold') : ''
                      }`}
                    >
                      <span className={`w-4 text-right opacity-40`}>{i + 1}.</span>
                      <span className="flex-1">{gameState.moveHistory[i * 2]?.notation}</span>
                      {gameState.moveHistory[i * 2 + 1] && (
                        <span className="flex-1 opacity-80">{gameState.moveHistory[i * 2 + 1]?.notation}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── MOBILE & TABLET RESPONSIVE TABBED CONTAINER (Screen < 1024px) ─── */}
        <div className="flex lg:hidden flex-col w-full max-w-[440px] mt-2 space-y-2.5">
          {/* Mobile Tab Selector */}
          <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl glass shadow-md">
            <button
              onClick={() => setMobileTab('coach')}
              className={`py-2 px-1 rounded-xl text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 transition-all ${
                mobileTab === 'coach'
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40 shadow-sm'
                  : 'opacity-60 hover:opacity-90'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              <span>Coach</span>
            </button>

            <button
              onClick={() => setMobileTab('moves')}
              className={`py-2 px-1 rounded-xl text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 transition-all ${
                mobileTab === 'moves'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'opacity-60 hover:opacity-90'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Moves</span>
            </button>

            <button
              onClick={() => setMobileTab('controls')}
              className={`py-2 px-1 rounded-xl text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 transition-all ${
                mobileTab === 'controls'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'opacity-60 hover:opacity-90'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Game</span>
            </button>

            <button
              onClick={() => setMobileTab('captures')}
              className={`py-2 px-1 rounded-xl text-[11px] font-bold flex flex-col sm:flex-row items-center justify-center gap-1 transition-all ${
                mobileTab === 'captures'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'opacity-60 hover:opacity-90'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Pieces</span>
            </button>
          </div>

          {/* Mobile Tab Content Cards */}
          <div className="w-full">
            {mobileTab === 'coach' && (
              <div>
                {gameMode !== 'pvp' ? (
                  <CoachPanel
                    enabled={coachEnabled}
                    onToggle={() => setCoachEnabled(!coachEnabled)}
                    suggestion={coachSuggestion}
                    isCoachThinking={coachThinking}
                    isPlayersTurn={isPlayersTurn}
                    isGameOver={isGameOver}
                    gameOverText={status}
                    feedback={coachFeedback}
                    isLight={isLight}
                  />
                ) : (
                  <div className="glass-panel rounded-2xl p-4 text-center">
                    <Users className="w-6 h-6 text-violet-400 mx-auto mb-1.5" />
                    <p className="text-xs font-semibold">Playing in 2-Player Local Mode</p>
                    <p className="text-[11px] opacity-60 mt-1">Switch to "Play vs AI" in the Game tab to enable the Learning Coach.</p>
                  </div>
                )}
              </div>
            )}

            {mobileTab === 'moves' && (
              <div className="glass-panel rounded-2xl overflow-hidden flex flex-col max-h-[220px]">
                <div className={`flex items-center justify-between px-3.5 py-2 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
                  <span className="text-xs font-bold uppercase tracking-wider">Move List</span>
                  <span className="text-[10px] font-mono opacity-50">{gameState.moveHistory.length} moves</span>
                </div>
                <div className="flex-1 overflow-y-auto custom-scroll p-2 text-xs">
                  {gameState.moveHistory.length === 0 ? (
                    <div className="text-center py-6 text-xs italic opacity-40">No moves made yet</div>
                  ) : (
                    <div className="space-y-1">
                      {Array.from({ length: Math.ceil(gameState.moveHistory.length / 2) }).map((_, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-mono ${
                            i === Math.ceil(gameState.moveHistory.length / 2) - 1 ? (isLight ? 'bg-black/5 font-bold' : 'bg-white/10 font-bold') : ''
                          }`}
                        >
                          <span className="w-4 text-right opacity-40">{i + 1}.</span>
                          <span className="flex-1">{gameState.moveHistory[i * 2]?.notation}</span>
                          {gameState.moveHistory[i * 2 + 1] && (
                            <span className="flex-1 opacity-80">{gameState.moveHistory[i * 2 + 1]?.notation}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {mobileTab === 'controls' && (
              <div className="glass-panel rounded-2xl p-3.5 space-y-2.5">
                {/* Mode Select */}
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1 block">Game Mode</label>
                  <div className="grid grid-cols-4 gap-1">
                    {(['pvp', 'white', 'black', 'online'] as GameMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => selectGameMode(mode)}
                        className={`py-1.5 px-1 rounded-xl text-[10px] sm:text-xs font-semibold ${
                          gameMode === mode ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'glass opacity-70'
                        }`}
                      >
                        {mode === 'pvp' ? 'Local' : mode === 'white' ? 'AI White' : mode === 'black' ? 'AI Black' : 'Online'}
                      </button>
                    ))}
                  </div>
                </div>

                {gameMode === 'online' && (
                  <OnlineRoomPanel
                    room={online.room}
                    configured={online.isConfigured}
                    error={online.error}
                    isLight={isLight}
                    playerName={onlinePlayerName}
                    onPlayerNameChange={setOnlinePlayerName}
                    onCreate={createOnlineRoom}
                    onJoin={joinOnlineRoom}
                    onLeave={leaveOnlineRoom}
                    onClearError={online.clearError}
                  />
                )}

                {/* AI Difficulty Select */}
                {(gameMode === 'white' || gameMode === 'black') && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1 block">AI Strength (Speedy)</label>
                    <div className="grid grid-cols-4 gap-1">
                      {(['beginner', 'amateur', 'professional', 'superstar'] as AIDifficulty[]).map((diff) => (
                        <button
                          key={diff}
                          onClick={() => setAiDifficulty(diff)}
                          className={`py-1.5 px-1 rounded-xl text-[11px] font-semibold flex flex-col items-center gap-0.5 ${
                            aiDifficulty === diff ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'glass opacity-70'
                          }`}
                        >
                          {difficultyIcons[diff]}
                          <span className="truncate w-full text-center text-[10px]">{difficultyLabels[diff]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Player Names for PvP */}
                {gameMode === 'pvp' && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <input
                      type="text"
                      value={whiteName}
                      onChange={(e) => setWhiteName(e.target.value)}
                      placeholder="White name"
                      className="glass rounded-xl px-2.5 py-1.5 text-xs font-semibold outline-none"
                    />
                    <input
                      type="text"
                      value={blackName}
                      onChange={(e) => setBlackName(e.target.value)}
                      placeholder="Black name"
                      className="glass rounded-xl px-2.5 py-1.5 text-xs font-semibold outline-none"
                    />
                  </div>
                )}

                {/* Quick actions */}
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  <button
                    onClick={() => setIsFlipped(!isFlipped)}
                    className="glass rounded-xl py-2 flex flex-col items-center justify-center text-[10px] font-bold"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 mb-0.5" />
                    Flip
                  </button>
                  <button
                    onClick={toggleTheme}
                    className="glass rounded-xl py-2 flex flex-col items-center justify-center text-[10px] font-bold"
                  >
                    {isLight ? <Moon className="w-3.5 h-3.5 mb-0.5" /> : <Sun className="w-3.5 h-3.5 mb-0.5 text-amber-400" />}
                    {isLight ? 'Dark' : 'Light'}
                  </button>
                  <button
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    className="glass rounded-xl py-2 flex flex-col items-center justify-center text-[10px] font-bold"
                  >
                    {soundEnabled ? <Volume2 className="w-3.5 h-3.5 mb-0.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 mb-0.5 opacity-50" />}
                    Sound
                  </button>
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="glass rounded-xl py-2 flex flex-col items-center justify-center text-[10px] font-bold text-rose-400 border border-rose-500/20"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mb-0.5" />
                    Reset
                  </button>
                </div>
              </div>
            )}

            {mobileTab === 'captures' && (
              <div className="glass-panel rounded-2xl p-3.5 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider">{whiteDisplayName} Captures</span>
                    {materialDiff > 0 && <span className="text-xs font-bold text-emerald-400">+{materialDiff}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1 items-center min-h-[24px]">
                    {captured.black.map((p, i) => (
                      <span key={i} className="text-lg">{PIECE_SYMBOLS.black[p.type]}</span>
                    ))}
                    {captured.black.length === 0 && <span className="text-xs italic opacity-40">No pieces taken</span>}
                  </div>
                </div>

                <div className="border-t border-white/5 pt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider">{blackDisplayName} Captures</span>
                    {materialDiff < 0 && <span className="text-xs font-bold text-emerald-400">+{-materialDiff}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1 items-center min-h-[24px]">
                    {captured.white.map((p, i) => (
                      <span key={i} className="text-lg">{PIECE_SYMBOLS.white[p.type]}</span>
                    ))}
                    {captured.white.length === 0 && <span className="text-xs italic opacity-40">No pieces taken</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Promotion Choice Dialog */}
      <AnimatePresence>
        {promotionSquare && (
          <PromotionDialog
            color={turn}
            onSelect={handlePromotion}
            onCancel={() => {
              setPromotionSquare(null);
              setPromotionFrom(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* New Game Reset Confirmation Dialog */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="absolute inset-0 bg-black/50 backdrop-blur-sm" 
              onClick={() => setShowConfirm(false)} 
            />
            <motion.div
              className="relative glass-strong rounded-2xl p-5 max-w-sm w-full shadow-2xl"
              initial={{ scale: 0.9, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 15 }}
              transition={{ type: 'spring', stiffness: 450, damping: 28 }}
            >
              <h3 className={`text-base font-bold mb-2 ${isLight ? 'text-slate-800' : 'text-white'}`}>Start New Chess Game?</h3>
              <p className={`text-xs mb-4 leading-relaxed ${isLight ? 'text-slate-500' : 'text-white/60'}`}>
                This will reset the current board and start a fresh game. Current progress will be lost.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className={`flex-1 glass rounded-xl py-2 text-xs font-bold ${isLight ? 'text-slate-600' : 'text-white/70'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => resetGame(true)}
                  className="flex-1 glass rounded-xl py-2 text-xs font-bold text-white bg-rose-500/40 border border-rose-500/50 hover:bg-rose-500/60 shadow-md"
                >
                  New Game
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
