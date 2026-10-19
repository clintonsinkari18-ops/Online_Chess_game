/// <reference lib="webworker" />
/**
 * chessWorker.ts — Runs every chess search off the main thread.
 *
 * The UI thread stays completely responsive while the AI thinks and while
 * the Learning Coach analyses the position.
 */

import { searchPosition, Pos, WHITE, BLACK, moveFrom, moveTo, movePromo, moveFlags, sqToName } from './fastEngine';
import { PosPayload, payloadToPos } from './positionCodec';

export interface WorkerRequest {
  id: number;
  mode: 'ai' | 'coach';
  payload: PosPayload;
  side: 'white' | 'black';
  depth: number;
  timeLimit: number;
  randomChance?: number;
}

export interface WorkerResponse {
  id: number;
  ok: boolean;
  move?: {
    from: string;
    to: string;
    promo?: string;
    isEnPassant?: boolean;
    isCastling?: 'kingside' | 'queenside';
  } | null;
  score?: number;
  scores?: Record<string, number>;
  depth?: number;
  nodes?: number;
  ms?: number;
  error?: string;
}

const PROMO_NAME: Record<number, string> = {
  1: 'queen',
  2: 'rook',
  3: 'bishop',
  4: 'knight',
};

function describeMove(encoded: number) {
  const from = sqToName(moveFrom(encoded));
  const to = sqToName(moveTo(encoded));
  const promo = movePromo(encoded);
  const flags = moveFlags(encoded);
  return {
    from,
    to,
    promo: promo ? PROMO_NAME[promo] : undefined,
    isEnPassant: flags === 1 ? true : undefined,
    isCastling: flags === 2 ? ('kingside' as const) : flags === 3 ? ('queenside' as const) : undefined,
  };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    const pos: Pos = payloadToPos(req.payload);
    const side = req.side === 'white' ? WHITE : BLACK;

    // Optional random blunder for weaker levels
    let chosen: number | null = null;
    if (req.randomChance && req.randomChance > 0 && Math.random() < req.randomChance) {
      // Use a shallow search and pick a random move from the root
      const quick = searchPosition(pos, side, 1, 40);
      const keys = Object.keys(quick.scores);
      if (keys.length > 1) {
        const pick = keys[Math.floor(Math.random() * keys.length)];
        const from = pick.slice(0, 2);
        const to = pick.slice(2, 4);
        const fromSq = nameToSqLocal(from);
        const toSq = nameToSqLocal(to);
        chosen = fromSq | (toSq << 8);
      }
    }

    const outcome = searchPosition(pos, side, req.depth, req.timeLimit);
    const finalMove = chosen ?? outcome.move;

    const response: WorkerResponse = {
      id: req.id,
      ok: true,
      move: finalMove !== null ? describeMove(finalMove) : null,
      score: outcome.score,
      scores: outcome.scores,
      depth: outcome.depth,
      nodes: outcome.nodes,
      ms: outcome.ms,
    };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};

function nameToSqLocal(name: string): number {
  return (8 - parseInt(name[1], 10)) * 16 + (name.charCodeAt(0) - 97);
}
