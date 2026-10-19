import { motion, AnimatePresence } from 'framer-motion';
import { Color, PieceType, PIECE_SYMBOLS } from '../chess/types';
import { useTheme } from '../context/ThemeContext';

interface PromotionDialogProps {
  color: Color;
  onSelect: (type: PieceType) => void;
  onCancel: () => void;
}

const PromotionDialog = ({ color, onSelect, onCancel }: PromotionDialogProps) => {
  const { theme } = useTheme();
  const options: PieceType[] = ['queen', 'rook', 'bishop', 'knight'];
  const isLight = theme === 'light';

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onCancel}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
        <motion.div
          className="relative glass-strong rounded-2xl p-6 max-w-sm w-full"
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <h3 className={`text-base font-semibold mb-4 text-center ${isLight ? 'text-slate-800' : 'text-white'}`}>
            Choose Promotion
          </h3>
          <div className="flex gap-2 justify-center">
            {options.map((type, i) => (
              <motion.button
                key={type}
                className="w-16 h-16 flex items-center justify-center rounded-xl glass-button transition-all duration-200"
                onClick={() => onSelect(type)}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.08, type: 'spring', stiffness: 400, damping: 20 }}
                whileHover={{ scale: 1.1, y: -2 }}
                whileTap={{ scale: 0.95 }}
              >
                <span
                  className="text-4xl transition-transform"
                  style={{
                    color: color === 'white' ? (isLight ? '#334' : '#fff') : (isLight ? '#1a1a1a' : '#1a1a1a'),
                    textShadow:
                      color === 'white'
                        ? isLight 
                          ? '0 0 4px rgba(0,0,0,0.15)'
                          : '0 0 4px rgba(0,0,0,0.5), 0 0 8px rgba(0,0,0,0.3)'
                        : isLight
                          ? '0 0 4px rgba(255,255,255,0.3)'
                          : '0 0 4px rgba(255,255,255,0.25)',
                    filter: color === 'white' 
                      ? isLight ? 'drop-shadow(0 0 2px rgba(0,0,0,0.15))' : 'drop-shadow(0 0 2px rgba(0,0,0,0.3))'
                      : isLight ? 'drop-shadow(0 0 2px rgba(255,255,255,0.3))' : 'drop-shadow(0 0 2px rgba(255,255,255,0.15))',
                  }}
                >
                  {PIECE_SYMBOLS[color][type]}
                </span>
              </motion.button>
            ))}
          </div>
          <motion.button
            onClick={onCancel}
            className={`w-full mt-4 glass-button rounded-xl py-2 text-sm ${isLight ? 'text-slate-500 hover:text-slate-700' : 'text-white/50 hover:text-white/80'}`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Cancel
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PromotionDialog;
