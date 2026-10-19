import { GameState } from './types';
import { gameStateToPayload, payloadToPos } from './positionCodec';
import { WorkerRequest, WorkerResponse } from './chessWorker';
import {
  searchPosition,
  moveFrom,
  moveTo,
  movePromo,
  moveFlags,
  sqToName,
  WHITE,
  BLACK,
} from './fastEngine';
import ChessWorker from './chessWorker?worker&inline';

export interface EngineMove {
  from: string;
  to: string;
  promo?: string;
  isEnPassant?: boolean;
  isCastling?: 'kingside' | 'queenside';
}

export interface EngineResult {
  move: EngineMove | null;
  score: number;
  scores: Record<string, number>;
  depth: number;
  nodes: number;
  ms: number;
}

type Pending = {
  resolve: (r: EngineResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const PROMO_NAME: Record<number, string> = {
  1: 'queen',
  2: 'rook',
  3: 'bishop',
  4: 'knight',
};

/** Main-thread fallback (used only if Workers are blocked by the browser). */
function fallbackSearch(
  state: GameState,
  side: 'white' | 'black',
  depth: number,
  timeLimit: number
): EngineResult {
  const pos = payloadToPos(gameStateToPayload(state));
  const outcome = searchPosition(
    pos,
    side === 'white' ? WHITE : BLACK,
    Math.max(1, Math.min(depth, 4)),
    Math.min(timeLimit, 70)
  );
  if (outcome.move === null) {
    return {
      move: null,
      score: outcome.score,
      scores: outcome.scores,
      depth: outcome.depth,
      nodes: outcome.nodes,
      ms: outcome.ms,
    };
  }
  const encoded = outcome.move;
  const flags = moveFlags(encoded);
  return {
    move: {
      from: sqToName(moveFrom(encoded)),
      to: sqToName(moveTo(encoded)),
      promo: PROMO_NAME[movePromo(encoded)],
      isEnPassant: flags === 1 ? true : undefined,
      isCastling: flags === 2 ? 'kingside' : flags === 3 ? 'queenside' : undefined,
    },
    score: outcome.score,
    scores: outcome.scores,
    depth: outcome.depth,
    nodes: outcome.nodes,
    ms: outcome.ms,
  };
}

class EngineClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private failed = false;

  private ensureWorker(): Worker | null {
    if (this.failed) return null;
    if (this.worker) return this.worker;

    try {
      const worker = new ChessWorker();
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        const entry = this.pending.get(data.id);
        if (!entry) return;
        this.pending.delete(data.id);
        clearTimeout(entry.timer);
        if (!data.ok) {
          entry.reject(new Error(data.error || 'Engine error'));
          return;
        }
        entry.resolve({
          move: data.move ?? null,
          score: data.score ?? 0,
          scores: data.scores ?? {},
          depth: data.depth ?? 0,
          nodes: data.nodes ?? 0,
          ms: data.ms ?? 0,
        });
      };
      worker.onerror = () => {
        this.failed = true;
        this.worker = null;
        this.pending.forEach((entry) => {
          clearTimeout(entry.timer);
          entry.reject(new Error('Worker crashed'));
        });
        this.pending.clear();
      };
      return worker;
    } catch (err) {
      console.warn('Web Worker unavailable, falling back to main thread.', err);
      this.failed = true;
      return null;
    }
  }

  /** Runs a search in the worker. Rejects if the worker is unavailable. */
  private request(
    req: Omit<WorkerRequest, 'id'>,
    timeoutMs: number,
    fallback: () => EngineResult
  ): Promise<EngineResult> {
    const worker = this.ensureWorker();
    if (!worker) {
      // Degrade gracefully instead of failing outright
      return new Promise<EngineResult>((resolve) => {
        setTimeout(() => {
          try {
            resolve(fallback());
          } catch {
            resolve({
              move: null,
              score: 0,
              scores: {},
              depth: 0,
              nodes: 0,
              ms: 0,
            });
          }
        }, 0);
      });
    }

    const id = this.nextId++;
    return new Promise<EngineResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        try {
          resolve(fallback());
        } catch {
          reject(new Error('timeout'));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ ...req, id });
    });
  }

  /**
   * AI opponent search. Runs off the main thread so the UI never freezes.
   */
  searchAI(
    state: GameState,
    side: 'white' | 'black',
    depth: number,
    timeLimit: number,
    randomChance: number
  ): Promise<EngineResult> {
    return this.request(
      {
        mode: 'ai',
        payload: gameStateToPayload(state),
        side,
        depth,
        timeLimit,
        randomChance,
      },
      timeLimit + 4000,
      () => fallbackSearch(state, side, depth, timeLimit)
    );
  }

  /**
   * Learning-coach analysis. Returns the best move plus the score of every
   * legal root move so move feedback is instant (no extra search needed).
   */
  analyzeCoach(
    state: GameState,
    side: 'white' | 'black',
    depth: number,
    timeLimit: number
  ): Promise<EngineResult> {
    return this.request(
      {
        mode: 'coach',
        payload: gameStateToPayload(state),
        side,
        depth,
        timeLimit,
      },
      timeLimit + 4000,
      () => fallbackSearch(state, side, depth, timeLimit)
    );
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(new Error('terminated'));
    });
    this.pending.clear();
  }
}

export const engineClient = new EngineClient();
