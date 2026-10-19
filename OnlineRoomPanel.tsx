import { useState } from 'react';
import { Copy, Link2, LoaderCircle, LogOut, Radio, ShieldCheck, UserPlus, Wifi, WifiOff } from 'lucide-react';
import { OnlineRoom } from '../online/useOnlineRoom';

interface OnlineRoomPanelProps {
  room: OnlineRoom | null;
  configured: boolean;
  error: string | null;
  isLight: boolean;
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  onCreate: (name: string) => Promise<string | null>;
  onJoin: (code: string, name: string) => Promise<boolean>;
  onLeave: () => void;
  onClearError: () => void;
}

export default function OnlineRoomPanel({
  room,
  configured,
  error,
  isLight,
  playerName,
  onPlayerNameChange,
  onCreate,
  onJoin,
  onLeave,
  onClearError,
}: OnlineRoomPanelProps) {
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get('room') || '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = isLight ? 'text-slate-700' : 'text-white/85';
  const dim = isLight ? 'text-slate-500' : 'text-white/50';

  const create = async () => {
    setBusy(true);
    onClearError();
    await onCreate(playerName);
    setBusy(false);
  };

  const join = async () => {
    if (!joinCode.trim()) return;
    setBusy(true);
    onClearError();
    await onJoin(joinCode, playerName);
    setBusy(false);
  };

  const copyInvite = async () => {
    if (!room) return;
    const invite = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      await navigator.clipboard.writeText(room.code).catch(() => undefined);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Radio className="w-4 h-4 text-cyan-400" />
        <div>
          <div className={`text-xs font-bold ${text}`}>Play Online</div>
          <div className={`text-[10px] ${dim}`}>Invite a friend anywhere</div>
        </div>
        {room && (
          <span className={`ml-auto flex items-center gap-1 text-[10px] font-semibold ${room.opponentConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
            {room.opponentConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {room.opponentConnected ? (room.opponentSynced ? 'Opponent online' : 'Syncing') : 'Waiting'}
          </span>
        )}
      </div>

      {!configured && !room && (
        <div className={`rounded-xl p-2.5 text-[11px] leading-relaxed ${isLight ? 'bg-amber-50 text-amber-900' : 'bg-amber-400/10 text-amber-100/80'}`}>
          Online play needs a free Supabase project. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your hosting settings.
        </div>
      )}

      {room ? (
        <>
          <div className={`rounded-xl p-3 text-center ${isLight ? 'bg-white/55' : 'bg-black/15'}`}>
            <div className={`text-[10px] uppercase tracking-widest ${dim}`}>Room code · play {room.color}</div>
            <div className={`my-1 font-mono text-2xl font-extrabold tracking-[0.22em] ${isLight ? 'text-slate-800' : 'text-white'}`}>
              {room.code}
            </div>
            <div className={`text-[11px] ${dim}`}>
              {room.connected
                ? room.opponentConnected
                  ? room.opponentSynced
                    ? `Playing ${room.opponentName}`
                    : 'Syncing the starting position…'
                  : 'Share the invite link or code with your opponent.'
                : 'Connecting to the room…'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void copyInvite()} className="glass-button rounded-xl px-2 py-2 text-xs font-semibold flex items-center justify-center gap-1.5">
              {copied ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy invite'}
            </button>
            <button onClick={onLeave} className="glass-button rounded-xl px-2 py-2 text-xs font-semibold text-rose-400 flex items-center justify-center gap-1.5">
              <LogOut className="w-3.5 h-3.5" /> Leave room
            </button>
          </div>
        </>
      ) : (
        <>
          <label className={`block text-[10px] font-semibold uppercase tracking-wider ${dim}`}>
            Your name
            <input
              value={playerName}
              onChange={(event) => onPlayerNameChange(event.target.value.slice(0, 18))}
              placeholder="Player name"
              maxLength={18}
              className={`glass mt-1 w-full rounded-xl px-3 py-2 text-xs outline-none ${text}`}
            />
          </label>
          <button
            onClick={() => void create()}
            disabled={busy || !configured}
            className="glass-button w-full rounded-xl px-3 py-2.5 text-xs font-bold text-cyan-300 flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {busy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            Create room as White
          </button>
          <div className={`flex items-center gap-2 text-[9px] uppercase tracking-widest ${dim}`}>
            <span className="h-px flex-1 bg-white/10" /> or join a room <span className="h-px flex-1 bg-white/10" />
          </div>
          <div className="flex gap-1.5">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              onKeyDown={(event) => { if (event.key === 'Enter') void join(); }}
              placeholder="Enter room code"
              maxLength={8}
              className={`glass min-w-0 flex-1 rounded-xl px-3 py-2 text-xs font-mono uppercase tracking-widest outline-none ${text}`}
            />
            <button
              onClick={() => void join()}
              disabled={busy || !configured || joinCode.length < 6}
              className="glass-button rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
            >
              {busy ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Join
            </button>
          </div>
          {joinCode && !room && (
            <p className={`text-[10px] ${dim}`}>
              You will join as Black. <span className="inline-flex items-center gap-0.5"><Link2 className="w-2.5 h-2.5" /> Invite links can prefill this code.</span>
            </p>
          )}
        </>
      )}

      {error && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 p-2 text-[11px] leading-relaxed text-rose-300">
          <span>{error}</span>
          <button onClick={onClearError} aria-label="Dismiss error" className="shrink-0">×</button>
        </div>
      )}
    </div>
  );
}