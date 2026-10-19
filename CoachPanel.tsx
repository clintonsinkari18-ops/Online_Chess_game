import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Lightbulb, Sparkles, Trophy, Users, Award, Compass, MessageSquare } from 'lucide-react';
import { CoachSuggestion, CoachFeedback } from '../chess/coach';

interface CoachPanelProps {
  enabled: boolean;
  onToggle: () => void;
  suggestion: CoachSuggestion | null;
  isCoachThinking: boolean;
  isPlayersTurn: boolean;
  isGameOver: boolean;
  gameOverText: string;
  feedback: CoachFeedback | null;
  isLight: boolean;
}

const fade = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.25 },
};

const CoachPanel = ({
  enabled,
  onToggle,
  suggestion,
  isCoachThinking,
  isPlayersTurn,
  isGameOver,
  gameOverText,
  feedback,
  isLight,
}: CoachPanelProps) => {
  const muted = isLight ? 'text-slate-400' : 'text-white/40';
  const body = isLight ? 'text-slate-600' : 'text-white/70';

  return (
    <div className="glass-panel rounded-2xl overflow-hidden flex flex-col h-full shadow-lg">
      {/* Header */}
      <div className={`flex items-center gap-2 px-3.5 py-2.5 sm:px-4 sm:py-3 border-b ${isLight ? 'border-black/5' : 'border-white/5'}`}>
        <div className="flex items-center gap-1.5">
          <GraduationCap className="w-4 h-4 text-violet-400" />
          <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${isLight ? 'text-slate-700' : 'text-white/90'}`}>
            Grandmaster Coach
          </span>
        </div>
        <button
          onClick={onToggle}
          className={`relative ml-auto w-9 h-5 rounded-full transition-colors ${
            enabled ? 'bg-violet-500/80' : isLight ? 'bg-slate-300' : 'bg-white/15'
          }`}
          aria-label="Toggle coach"
        >
          <motion.div
            layout
            className={`absolute top-0.5 w-4 h-4 rounded-full ${isLight ? 'bg-white' : 'bg-white/90'} shadow`}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            style={{ left: enabled ? '18px' : '2px' }}
          />
        </button>
      </div>

      <div className="p-3 sm:p-3.5 flex-1 overflow-y-auto custom-scroll space-y-3">
        <AnimatePresence mode="wait">
          {!enabled ? (
            <motion.div key="off" {...fade} className="py-3 sm:py-4">
              <Lightbulb className="w-6 h-6 text-violet-400/60 mx-auto mb-2" />
              <p className={`text-xs text-center leading-relaxed ${body}`}>
                Turn on the coach and get real-time Grandmaster move recommendations with deep tactical breakdowns for every single turn.
              </p>
            </motion.div>
          ) : isGameOver ? (
            <motion.div key="over" {...fade} className="py-2">
              <Trophy className="w-6 h-6 text-amber-400 mx-auto mb-2" />
              <p className={`text-xs font-semibold text-center leading-relaxed ${body}`}>{gameOverText}</p>
              <p className={`text-[10px] text-center mt-1.5 ${muted}`}>
                Start a new game to practice new tactics and strategies!
              </p>
            </motion.div>
          ) : isCoachThinking ? (
            <motion.div key="thinking" {...fade} className="py-4">
              <div className="flex flex-col items-center justify-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                >
                  <Sparkles className="w-5 h-5 text-violet-400" />
                </motion.div>
                <span className={`text-xs font-medium ${body}`}>Grandmaster engine calculating winning path...</span>
              </div>
            </motion.div>
          ) : suggestion && isPlayersTurn ? (
            <motion.div
              key={`sugg-${suggestion.notation}-${suggestion.move.from.col}-${suggestion.move.from.row}`}
              {...fade}
              className="space-y-2.5"
            >
              {/* Strategic Theme Badge */}
              <div className="flex items-center justify-between gap-1 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  {suggestion.theme}
                </span>
                {suggestion.isMatingMove && (
                  <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">
                    👑 MATING BLOW
                  </span>
                )}
              </div>

              {/* The Move */}
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl sm:text-3xl font-extrabold font-mono tracking-tight ${
                    isLight ? 'text-violet-700' : 'text-violet-300'
                  }`}
                >
                  {suggestion.notation}
                </span>
                <span className={`text-[10px] font-medium ${muted}`}>
                  {suggestion.hook}
                </span>
              </div>

              {/* Position Evaluation Status */}
              <div className={`p-2 rounded-xl text-[11px] leading-tight glass ${isLight ? 'bg-white/40 text-slate-700' : 'bg-white/5 text-white/80'}`}>
                {suggestion.scoreLabel}
              </div>

              {/* Multi-step Grandmaster Explanations */}
              <div className="space-y-1.5 pt-0.5">
                <div className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${muted}`}>
                  <Compass className="w-3 h-3 text-violet-400" />
                  Why this is the best move:
                </div>
                <ul className="space-y-1.5">
                  {suggestion.reasons.map((r, i) => (
                    <motion.li
                      key={i}
                      className={`flex items-start gap-2 text-xs leading-snug p-1.5 rounded-lg ${
                        isLight ? 'bg-slate-100/70 text-slate-700' : 'bg-white/5 text-white/80'
                      }`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 + i * 0.06 }}
                    >
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 shadow-[0_0_6px_rgba(167,139,250,0.8)]" />
                      <span>{r}</span>
                    </motion.li>
                  ))}
                </ul>
              </div>

              {/* Grandmaster Pro Tip */}
              {suggestion.proTip && (
                <div className={`p-2 rounded-xl text-[11px] leading-relaxed border ${
                  isLight 
                    ? 'bg-amber-50/70 border-amber-200 text-amber-900' 
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-200/90'
                }`}>
                  <div className="font-semibold flex items-center gap-1 mb-0.5 text-[10px] uppercase tracking-wide text-amber-400">
                    <Award className="w-3 h-3" /> Master Strategy
                  </div>
                  {suggestion.proTip}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="waiting" {...fade} className="py-3 sm:py-4">
              <Users className="w-5 h-5 text-violet-400/60 mx-auto mb-2" />
              <p className={`text-xs text-center leading-relaxed ${body}`}>
                Opponent is thinking. Your next Grandmaster move analysis will appear as soon as their move lands.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic Interactive Move Feedback */}
        <AnimatePresence>
          {feedback && enabled && !isGameOver && (
            <motion.div
              key="feedback"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`p-2.5 rounded-xl border text-xs leading-snug ${
                feedback.kind === 'followed'
                  ? isLight
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : isLight
                    ? 'bg-amber-50/80 border-amber-200 text-amber-900'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
            >
              <div className="font-bold flex items-center gap-1.5 mb-1 text-xs">
                <MessageSquare className="w-3.5 h-3.5" />
                {feedback.title}
              </div>
              <p className="text-[11px] leading-relaxed opacity-95">{feedback.text}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default CoachPanel;
