import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';
import type { Arrow, BoardPosition, CustomSquareStyles } from 'react-chessboard/dist/chessboard/types';

export type MoveInput = { from: string; to: string; promotion?: string };

type Props = {
  position: string | BoardPosition;
  orientation?: 'white' | 'black';
  // Qué bando puede mover el usuario; null = tablero de solo lectura.
  movable?: 'w' | 'b' | 'both' | null;
  onMove?: (m: MoveInput) => boolean;
  lastMove?: [string, string] | null;
  arrows?: Arrow[];
  squareStyles?: Record<string, CSSProperties>;
  onSquareClick?: (square: string) => void;
  showNotation?: boolean;
  badge?: { square: string; content: ReactNode; color: string } | null;
  animation?: number;
  maxWidth?: number;
};

export const BOARD_LIGHT = '#ecd8b4';
export const BOARD_DARK = '#ad8259';

export default function Board({
  position,
  orientation = 'white',
  movable = null,
  onMove,
  lastMove,
  arrows,
  squareStyles,
  onSquareClick,
  showNotation = true,
  badge,
  animation = 220,
  maxWidth = 640,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(maxWidth, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  const fen = typeof position === 'string' ? position : null;
  const chess = useMemo(() => {
    if (!fen) return null;
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);

  useEffect(() => setSelected(null), [fen]);

  const canMove = (color: string) => movable === 'both' || movable === color;

  const targets = useMemo(() => {
    if (!chess || !selected) return [];
    return chess.moves({ square: selected as Square, verbose: true });
  }, [chess, selected]);

  const styles: Record<string, CSSProperties> = {};
  if (lastMove) {
    for (const sq of lastMove) styles[sq] = { background: 'rgba(205, 210, 106, 0.6)' };
  }
  if (chess?.inCheck()) {
    const king = chess
      .board()
      .flat()
      .find((p) => p && p.type === 'k' && p.color === chess.turn());
    if (king) styles[king.square] = { background: 'radial-gradient(circle, rgba(255,40,40,.9) 0%, rgba(255,40,40,.35) 55%, transparent 75%)' };
  }
  if (selected) styles[selected] = { ...styles[selected], background: 'rgba(20, 85, 30, 0.45)' };
  for (const t of targets) {
    styles[t.to] = {
      ...styles[t.to],
      backgroundImage: t.captured
        ? 'radial-gradient(circle, transparent 58%, rgba(20,30,50,.35) 60%)'
        : 'radial-gradient(circle, rgba(20,30,50,.3) 22%, transparent 24%)',
    };
  }
  Object.assign(styles, squareStyles);

  function tryMove(from: string, to: string, promotion?: string) {
    if (!onMove) return false;
    const piece = chess?.get(from as Square);
    const needsPromo = piece?.type === 'p' && (to[1] === '8' || to[1] === '1');
    const ok = onMove({ from, to, promotion: needsPromo ? promotion ?? 'q' : undefined });
    setSelected(null);
    return ok;
  }

  function handleSquareClick(square: string) {
    onSquareClick?.(square);
    if (!chess || !movable) return;
    if (selected && targets.some((t) => t.to === square)) {
      tryMove(selected, square);
      return;
    }
    const p = chess.get(square as Square);
    if (p && p.color === chess.turn() && canMove(p.color)) setSelected(square);
    else setSelected(null);
  }

  // Posición de la insignia de clasificación (esquina superior derecha de la casilla).
  let badgeEl: ReactNode = null;
  if (badge) {
    const file = badge.square.charCodeAt(0) - 97;
    const rank = Number(badge.square[1]) - 1;
    const col = orientation === 'white' ? file : 7 - file;
    const row = orientation === 'white' ? 7 - rank : rank;
    const sq = width / 8;
    badgeEl = (
      <div
        key={badge.square + String(badge.content)}
        className="square-badge"
        style={{ left: (col + 1) * sq - sq * 0.22, top: row * sq - sq * 0.12, background: badge.color, width: sq * 0.42, height: sq * 0.42, fontSize: sq * 0.2 }}
      >
        {badge.content}
      </div>
    );
  }

  return (
    <div className="board-wrap" ref={wrap} style={{ maxWidth }}>
      <div className="board-inner" style={{ width, height: width }}>
        <Chessboard
          id="main-board"
          position={position}
          boardWidth={width}
          boardOrientation={orientation}
          animationDuration={animation}
          arePiecesDraggable={!!movable}
          isDraggablePiece={({ piece }) => canMove(piece[0]) && chess?.turn() === piece[0]}
          onPieceDragBegin={(_, sq) => setSelected(sq)}
          onPieceDrop={(from, to, piece) => {
            const promo = piece[1]?.toLowerCase();
            return tryMove(from, to, promo && 'qrbn'.includes(promo) ? promo : undefined);
          }}
          onSquareClick={handleSquareClick}
          customSquareStyles={styles as CustomSquareStyles}
          customArrows={arrows}
          showBoardNotation={showNotation}
          customLightSquareStyle={{ backgroundColor: BOARD_LIGHT }}
          customDarkSquareStyle={{ backgroundColor: BOARD_DARK }}
          customBoardStyle={{ borderRadius: 3, boxShadow: '0 6px 24px rgba(0,0,0,.35)' }}
          customDropSquareStyle={{ boxShadow: 'inset 0 0 0 4px rgba(255,214,79,.9)' }}
          areArrowsAllowed
        />
        {badgeEl}
      </div>
    </div>
  );
}
