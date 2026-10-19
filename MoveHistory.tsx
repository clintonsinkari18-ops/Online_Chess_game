import React, { useRef, useEffect } from 'react';
import { Move } from '../chess/types';

interface MoveHistoryProps {
  moves: Move[];
  onJumpToMove?: (index: number) => void;
}

const MoveHistory: React.FC<MoveHistoryProps> = ({ moves }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [moves]);

  const movePairs: { number: number; white: Move; black?: Move }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    movePairs.push({
      number: Math.floor(i / 2) + 1,
      white: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden flex flex-col h-full">
      <div className="px-4 py-3 bg-gray-700 border-b border-gray-600">
        <h3 className="text-white font-bold text-sm uppercase tracking-wider">
          Move History
        </h3>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 scrollbar-thin"
        style={{ maxHeight: '400px', minHeight: '100px' }}
      >
        {movePairs.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8 italic">
            No moves yet
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {movePairs.map((pair) => (
                <tr
                  key={pair.number}
                  className="border-b border-gray-700 hover:bg-gray-700 transition-colors"
                >
                  <td className="py-1.5 px-2 text-gray-500 font-mono w-10 text-right">
                    {pair.number}.
                  </td>
                  <td className="py-1.5 px-2 text-white font-mono">
                    {pair.white.notation ||
                      `${String.fromCharCode(97 + pair.white.from.col)}${8 - pair.white.from.row}${String.fromCharCode(97 + pair.white.to.col)}${8 - pair.white.to.row}`}
                  </td>
                  <td className="py-1.5 px-2 text-white font-mono">
                    {pair.black
                      ? pair.black.notation ||
                        `${String.fromCharCode(97 + pair.black.from.col)}${8 - pair.black.from.row}${String.fromCharCode(97 + pair.black.to.col)}${8 - pair.black.to.row}`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default MoveHistory;
