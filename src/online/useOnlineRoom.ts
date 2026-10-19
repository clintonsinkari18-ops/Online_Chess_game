import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Color, GameState, Move, PieceType } from '../chess/types';

export interface OnlineRoom {
  code: string;
  color: Color;
  playerName: string;
  opponentName: string;
  connected: boolean;
  opponentConnected: boolean;
  opponentSynced: boolean;
}

export interface IncomingOnlineMove {
  id: string;
  color: Color;
  from: string;
  to: string;
  promotion?: PieceType;
}

export interface OnlineSnapshot {
  id: string;
  state: GameState;
  whiteName: string;
  blackName: string;
}

export interface IncomingOnlineReset {
  id: string;
}

interface PresencePlayer {
  playerId: string;
  color: Color;
  name: string;
}

interface MovePayload {
  id: string;
  color: Color;
  from: string;
  to: string;
  promotion?: PieceType;
}

interface SnapshotPayload {
  state: GameState;
  whiteName: string;
  blackName: string;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const supabase: SupabaseClient | null = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeRoomCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function makeId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useOnlineRoom() {
  const [room, setRoom] = useState<OnlineRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incomingMove, setIncomingMove] = useState<IncomingOnlineMove | null>(null);
  const [snapshot, setSnapshot] = useState<OnlineSnapshot | null>(null);
  const [incomingReset, setIncomingReset] = useState<IncomingOnlineReset | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const roomRef = useRef<OnlineRoom | null>(null);
  const snapshotRef = useRef<GameState | null>(null);
  const playerNamesRef = useRef({ white: 'White', black: 'Black' });
  const playerIdRef = useRef(makeId());
  const connectGenerationRef = useRef(0);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConfigured = Boolean(supabase);

  const stopSyncRequests = useCallback(() => {
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    syncIntervalRef.current = null;
  }, []);

  const leaveRoom = useCallback(async () => {
    connectGenerationRef.current++;
    stopSyncRequests();
    const channel = channelRef.current;
    channelRef.current = null;
    roomRef.current = null;
    snapshotRef.current = null;
    setRoom(null);
    setIncomingMove(null);
    setSnapshot(null);
    setIncomingReset(null);
    setError(null);
    if (channel && supabase) await supabase.removeChannel(channel);
  }, [stopSyncRequests]);

  const startRoom = useCallback(async (code: string, color: Color, playerName: string) => {
    if (!supabase) {
      setError('Online play needs Supabase setup. Add the URL and public key to the hosting environment variables.');
      return false;
    }

    await leaveRoom();
    const generation = connectGenerationRef.current;
    const normalizedName = playerName.trim().slice(0, 18) || (color === 'white' ? 'White' : 'Black');
    const normalizedCode = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (normalizedCode.length < 6 || normalizedCode.length > 8) {
      setError('Room codes contain 6 to 8 letters or numbers.');
      return false;
    }

    const details: OnlineRoom = {
      code: normalizedCode,
      color,
      playerName: normalizedName,
      opponentName: color === 'white' ? 'Waiting for opponent' : 'Host',
      connected: false,
      opponentConnected: false,
      opponentSynced: false,
    };
    roomRef.current = details;
    playerNamesRef.current[color] = normalizedName;
    setRoom(details);
    setError(null);
    setIncomingMove(null);
    setSnapshot(null);
    setIncomingReset(null);

    const playerId = playerIdRef.current;
    const channel = supabase.channel(`glass-chess-${normalizedCode}`, {
      config: {
        private: false,
        broadcast: { self: false, ack: true },
        presence: { key: playerId },
      },
    });
    channelRef.current = channel;

    const sendSnapshot = async () => {
      if (color !== 'white' || !snapshotRef.current) return;
      await channel.send({
        type: 'broadcast',
        event: 'room_snapshot',
        payload: {
          state: snapshotRef.current,
          whiteName: playerNamesRef.current.white,
          blackName: playerNamesRef.current.black,
        } satisfies SnapshotPayload,
      });
    };

    const updatePresence = () => {
      const peers = Object.values(channel.presenceState<PresencePlayer>()).flat();
      const opponent = peers.find((peer) => peer.playerId !== playerId && peer.color !== color);
      const current = roomRef.current;
      if (!current || current.code !== normalizedCode) return;
      const next = {
        ...current,
        opponentConnected: Boolean(opponent),
        opponentSynced: opponent ? current.opponentSynced : false,
        opponentName: opponent?.name || (color === 'white' ? 'Waiting for opponent' : current.opponentName),
      };
      roomRef.current = next;
      setRoom(next);
      if (opponent) playerNamesRef.current[opponent.color] = opponent.name;
    };

    channel
      .on('presence', { event: 'sync' }, updatePresence)
      .on('broadcast', { event: 'request_sync' }, () => {
        void sendSnapshot();
      })
      .on('broadcast', { event: 'room_snapshot' }, ({ payload }) => {
        if (color !== 'black' || generation !== connectGenerationRef.current) return;
        const data = payload as SnapshotPayload;
        if (!data?.state?.board || !Array.isArray(data.state.moveHistory)) return;
        playerNamesRef.current = { white: data.whiteName || 'White', black: normalizedName };
        setSnapshot({
          id: makeId(),
          state: data.state,
          whiteName: data.whiteName || 'White',
          blackName: normalizedName,
        });
        stopSyncRequests();
      })
      .on('broadcast', { event: 'room_sync_ack' }, ({ payload }) => {
        if (color !== 'white' || generation !== connectGenerationRef.current) return;
        const current = roomRef.current;
        if (!current || !current.opponentConnected) return;
        const guest = Object.values(channel.presenceState<PresencePlayer>())
          .flat()
          .find((player) => player.color === 'black');
        if (!guest || payload?.playerId !== guest.playerId) return;
        const next = { ...current, opponentSynced: true };
        roomRef.current = next;
        setRoom(next);
      })
      .on('broadcast', { event: 'room_move' }, ({ payload }) => {
        if (generation !== connectGenerationRef.current) return;
        const data = payload as MovePayload;
        if (!data?.id || (data.color !== 'white' && data.color !== 'black')) return;
        setIncomingMove(data);
      })
      .on('broadcast', { event: 'room_reset' }, () => {
        if (generation === connectGenerationRef.current) setIncomingReset({ id: makeId() });
      })
      .on('broadcast', { event: 'room_resign' }, ({ payload }) => {
        if (generation === connectGenerationRef.current && payload?.color !== color) {
          setError(`${payload?.name || 'Your opponent'} resigned.`);
        }
      })
      .subscribe(async (status, subscribeError) => {
        if (generation !== connectGenerationRef.current) return;

        if (status === 'SUBSCRIBED') {
          const existingPlayers = Object.values(channel.presenceState<PresencePlayer>()).flat();
          const seatTaken = existingPlayers.some((player) => player.color === color && player.playerId !== playerId);
          if (seatTaken) {
            await leaveRoom();
            setError(color === 'white' ? 'The White seat is already taken in this room.' : 'The Black seat is already taken in this room.');
            return;
          }

          const tracked = await channel.track({ playerId, color, name: normalizedName } satisfies PresencePlayer);
          if (generation !== connectGenerationRef.current) return;
          if (tracked !== 'ok') {
            setError('Could not register your seat. Please try joining again.');
            return;
          }

          const connectedRoom = { ...details, connected: true };
          roomRef.current = connectedRoom;
          setRoom(connectedRoom);
          updatePresence();

          if (color === 'black') {
            const requestSync = () => {
              void channel.send({ type: 'broadcast', event: 'request_sync', payload: { playerId } });
            };
            requestSync();
            stopSyncRequests();
            syncIntervalRef.current = setInterval(requestSync, 1200);
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRoom((current) => current ? { ...current, connected: false } : current);
          setError(subscribeError?.message || 'Could not connect to this room. Check the code and try again.');
        }
      });

    return true;
  }, [leaveRoom, stopSyncRequests]);

  const createRoom = useCallback(async (playerName: string) => {
    const code = makeRoomCode();
    const started = await startRoom(code, 'white', playerName);
    return started ? code : null;
  }, [startRoom]);

  const joinRoom = useCallback((code: string, playerName: string) => {
    return startRoom(code, 'black', playerName);
  }, [startRoom]);

  const updateSnapshot = useCallback((state: GameState, whiteName: string, blackName: string) => {
    snapshotRef.current = state;
    playerNamesRef.current = { white: whiteName, black: blackName };
  }, []);

  const acknowledgeSnapshot = useCallback(async () => {
    const channel = channelRef.current;
    const current = roomRef.current;
    if (!channel || !current?.connected || current.color !== 'black') return;
    const next = { ...current, opponentSynced: true };
    roomRef.current = next;
    setRoom(next);
    await channel.send({
      type: 'broadcast',
      event: 'room_sync_ack',
      payload: { playerId: playerIdRef.current },
    });
  }, []);

  const sendMove = useCallback(async (move: Move) => {
    const channel = channelRef.current;
    const current = roomRef.current;
    if (!channel || !current?.connected || move.piece.color !== current.color) return false;
    const payload: MovePayload = {
      id: makeId(),
      color: current.color,
      from: `${'abcdefgh'[move.from.col]}${8 - move.from.row}`,
      to: `${'abcdefgh'[move.to.col]}${8 - move.to.row}`,
      promotion: move.promotion,
    };
    const response = await channel.send({ type: 'broadcast', event: 'room_move', payload });
    return response === 'ok';
  }, []);

  const sendReset = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel || !roomRef.current?.connected) return false;
    return (await channel.send({ type: 'broadcast', event: 'room_reset', payload: { by: playerIdRef.current } })) === 'ok';
  }, []);

  const sendResign = useCallback(async () => {
    const channel = channelRef.current;
    const current = roomRef.current;
    if (!channel || !current?.connected) return false;
    return (await channel.send({
      type: 'broadcast',
      event: 'room_resign',
      payload: { color: current.color, name: current.playerName },
    })) === 'ok';
  }, []);

  const clearIncomingMove = useCallback((id: string) => {
    setIncomingMove((current) => current?.id === id ? null : current);
  }, []);

  const clearIncomingReset = useCallback((id: string) => {
    setIncomingReset((current) => current?.id === id ? null : current);
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const reportError = useCallback((message: string) => setError(message), []);

  useEffect(() => () => {
    stopSyncRequests();
    if (channelRef.current && supabase) void supabase.removeChannel(channelRef.current);
  }, [stopSyncRequests]);

  return {
    isConfigured,
    room,
    error,
    incomingMove,
    snapshot,
    incomingReset,
    createRoom,
    joinRoom,
    leaveRoom,
    updateSnapshot,
    acknowledgeSnapshot,
    sendMove,
    sendReset,
    sendResign,
    clearIncomingMove,
    clearIncomingReset,
    clearError,
    reportError,
  };
}