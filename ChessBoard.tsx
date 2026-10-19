import React from 'react';
import { Piece, Position } from '../chess/types';
import { PIECE_SYMBOLS } from '../chess/types';

interface SquareProps {
  row: number;
  col: number;
  piece: Piece | null;
  isLight: boolean;
  isSelected: boolean;
  isLegalTarget: boolean;
  isLastMoveFrom: boolean;
  isLastMoveTo: boolean;
  isCheck: boolean;
  onClick: () => void;
}

const Square: React.FC<SquareProps> = ({
  piece,
  isLight,
  isSelected,
  isLegalTarget,
  isLastMoveFrom,
  isLastMoveTo,
  isCheck,
  onClick,
}) => {
  const baseColor = isLight ? '#f0d9b5' : '#b58863';
  const selectedColor = isLight ? '#f7ec5a' : '#dac34a';
  const lastMoveColor = isLight ? '#f5f682' : '#baca44';

  let bgColor = baseColor;
  if (isSelected) bgColor = selectedColor;
  else if (isLastMoveFrom || isLastMoveTo) bgColor = lastMoveColor;

  const isCapture = isLegalTarget && piece;

  return (
    <div
      className="relative flex items-center justify-center cursor-pointer select-none transition-colors duration-100"
      style={{
        backgroundColor: bgColor,
        aspectRatio: '1',
      }}
      onClick={onClick}
    >
      {/* Legal move indicator */}
      {isLegalTarget && !isCapture && (
        <div
          className="rounded-full opacity-40"
          style={{
            width: '30%',
            height: '30%',
            backgroundColor: '#000',
          }}
        />
      )}
      {isLegalTarget && isCapture && (
        <div
          className="absolute inset-0 rounded-full border-4 border-black opacity-30"
          style={{ margin: '4px' }}
        />
      )}

      {/* Piece */}
      {piece && (
        <span
          className={`text-3xl sm:text-4xl md:text-5xl lg:text-6xl leading-none transition-transform duration-100 ${
            isSelected ? 'scale-110' : ''
          }`}
          style={{
            filter:
              piece.color === 'white'
                ? 'drop-shadow(1px 1px 1px rgba(0,0,0,0.3))'
                : 'drop-shadow(1px 1px 1px rgba(0,0,0,0.5))',
            color: piece.color === 'white' ? '#fff' : '#1a1a1a',
            textShadow:
              piece.color === 'white'
                ? '0 0 2px #000, 0 0 2px #000, 0 0 2px #000'
                : '0 0 2px rgba(255,255,255,0.3)',
            zIndex: 1,
          }}
        >
          {PIECE_SYMBOLS[piece.color][piece.type]}
        </span>
      )}

      {/* Check indicator */}
      {isCheck && (
        <div
          className="absolute inset-0 rounded-sm"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(255,0,0,0.8) 0%, rgba(255,0,0,0.4) 40%, transparent 70%)',
          }}
        />
      )}
    </div>
  );
};

interface BoardProps {
  board: Piece[][];
  selectedSquare: Position | null;
  legalMoves: Position[];
  lastMove: { from: Position; to: Position } | null;
  checkSquare: Position | null;
  onSquareClick: (row: number, col: number) => void;
  boardFlipped: boolean;
}

const ChessBoard: React.FC<BoardProps> = ({
  board,
  selectedSquare,
  legalMoves,
  lastMove,
  checkSquare,
  onSquareClick,
  boardFlipped,
}) => {
  const files = 'abcdefgh';
  const ranks = '87654321';

  const renderRows = () => {
    const rows = [];
    for (let displayRow = 0; displayRow < 8; displayRow++) {
      const actualRow = boardFlipped ? 7 - displayRow : displayRow;
      const cols = [];

      for (let displayCol = 0; displayCol < 8; displayCol++) {
        const actualCol = boardFlipped ? 7 - displayCol : displayCol;
        const piece = board[actualRow][actualCol];
        const isLight = (actualRow + actualCol) % 2 === 0;
        const isSelected =
          selectedSquare?.row === actualRow && selectedSquare?.col === actualCol;
        const isLegalTarget = legalMoves.some(
          (m) => m.row === actualRow && m.col === actualCol
        );
        const isLastMoveFrom =
          lastMove?.from.row === actualRow && lastMove?.from.col === actualCol;
        const isLastMoveTo =
          lastMove?.to.row === actualRow && lastMove?.to.col === actualCol;
        const isCheck =
          checkSquare?.row === actualRow && checkSquare?.col === actualCol;

        cols.push(
          <Square
            key={`${actualRow}-${actualCol}`}
            row={actualRow}
            col={actualCol}
            piece={piece}
            isLight={isLight}
            isSelected={isSelected}
            isLegalTarget={isLegalTarget}
            isLastMoveFrom={isLastMoveFrom}
            isLastMoveTo={isLastMoveTo}
            isCheck={isCheck}
            onClick={() => onSquareClick(actualRow, actualCol)}
          />
        );
      }

      rows.push(
        <div key={actualRow} className="grid grid-cols-8">
          {cols}
        </div>
      );
    }
    return rows;
  };

  const renderFileLabels = () => {
    const labels = [];
    for (let i = 0; i < 8; i++) {
      const actualCol = boardFlipped ? 7 - i : i;
      labels.push(
        <div
          key={actualCol}
          className="flex items-center justify-center text-xs font-semibold"
          style={{ color: i % 2 === 0 ? '#b58863' : '#f0d9b5' }}
        >
          {files[actualCol]}
        </div>
      );
    }
    return labels;
  };

  const renderRankLabels = () => {
    const labels = [];
    for (let i = 0; i < 8; i++) {
      const actualRow = boardFlipped ? 7 - i : i;
      labels.push(
        <div
          key={actualRow}
          className="flex items-center justify-center text-xs font-semibold w-4"
          style={{ color: i % 2 === 0 ? '#b58863' : '#f0d9b5' }}
        >
          {ranks[actualRow]}
        </div>
      );
    }
    return labels;
  };

  return (
    <div className="flex flex-col items-center">
      {/* Top file labels */}
      <div className="grid grid-cols-8 ml-4 mb-1" style={{ width: 'min(85vw, 560px)' }}>
        {renderFileLabels()}
      </div>

      <div className="flex">
        {/* Left rank labels */}
        <div className="flex flex-col justify-around" style={{ height: 'min(85vw, 560px)' }}>
          {renderRankLabels()}
        </div>

        {/* Board */}
        <div
          className="grid grid-rows-8 rounded-sm overflow-hidden shadow-2xl"
          style={{
            width: 'min(85vw, 560px)',
            height: 'min(85vw, 560px)',
          }}
        >
          {renderRows()}
        </div>
      </div>

      {/* Bottom file labels */}
      <div className="grid grid-cols-8 ml-4 mt-1" style={{ width: 'min(85vw, 560px)' }}>
        {renderFileLabels()}
      </div>
    </div>
  );
};

export default ChessBoard;
