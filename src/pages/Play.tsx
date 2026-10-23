import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board, { type MoveInput } from '../components/Board';
import Clock from '../components/Clock';
import MoveList from '../components/MoveList';
import Modal from '../components/Modal';
import Confetti from '../components/Confetti';
import AnimatedNumber from '../components/AnimatedNumber';
import { Engine } from '../lib/engine';
import { applyResult, classOf, getRating, RATING_LABELS, type RatingClass } from '../lib/elo';
import { botFor } from '../lib/bots';
import { playMoveSound, sound } from '../lib/sound';
import { analyzePgn } from '../lib/nav';
import { load, save } from '../lib/storage';

type TimeControl = { label: string; base: number; inc: number } | null;

const TIME_CONTROLS: { label: string; tc: TimeControl }[] = [
  { label: '1 min', tc: { label: '1 min', base: 60, inc: 0 } },
  { label: '1 | 1', tc: { label: '1 | 1', base: 60, inc: 1 } },
  { label: '3 min', tc: { label: '3 min', base: 180, inc: 0 } },
  { label: '3 | 2', tc: { label: '3 | 2', base: 180, inc: 2 } },
  { label: '5 min', tc: { label: '5 min', base: 300, inc: 0 } },
  { label: '10 min', tc: { label: '10 min', base: 600, inc: 0 } },
  { label: '15 | 10', tc: { label: '15 | 10', base: 900, inc: 10 } },
  { label: '30 min', tc: { label: '30 min', base: 1800, inc: 0 } },
  { label: 'Sin reloj', tc: null },
];

type Settings = { tcIndex: number; color: 'w' | 'b' | 'random'; adaptive: boolean; manualElo: number };

type Over = {
  score: number; // para el usuario
  title: string;
  reason: string;
  rating?: { before: number; after: number; cls: RatingClass };
};

export type SavedGame = { pgn: string; date: number; result: string; botElo: number; tc: string; color: 'w' | 'b' };

function insufficientFor(chess: Chess, color: 'w' | 'b') {
  const pieces = chess.board().flat().filter((p) => p && p.color === color && p.type !== 'k');
  return pieces.length === 0 || (pieces.length === 1 && (pieces[0]!.type === 'n' || pieces[0]!.type === 'b'));
}

export default function Play() {
  const [settings, setSettings] = useState<Settings>(() => load('playSettings', { tcIndex: 5, color: 'random', adaptive: true, manualElo: 1200 }));
  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup');
  const [fen, setFen] = useState(new Chess().fen());
  const [sans, setSans] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[string, string] | null>(null);
  const [userColor, setUserColor] = useState<'w' | 'b'>('w');
  const [botElo, setBotElo] = useState(1200);
  const [clocks, setClocks] = useState<{ w: number; b: number } | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [thinking, setThinking] = useState(false);

  const chessRef = useRef(new Chess());
  const engineRef = useRef<Engine | null>(null);
  const clockRef = useRef<{ w: number; b: number; last: number } | null>(null);
  const gameId = useRef(0);
  const tcRef = useRef<TimeControl>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const tc = TIME_CONTROLS[settings.tcIndex].tc;
  const ratingClass: RatingClass = tc ? classOf(tc.base, tc.inc) : 'rapid';

  useEffect(() => save('playSettings', settings), [settings]);

  useEffect(() => {
    engineRef.current = new Engine();
    return () => engineRef.current?.terminate();
  }, []);

  const finish = useCallback(
    (score: number, title: string, reason: string) => {
      if (phaseRef.current !== 'playing') return;
      phaseRef.current = 'over';
      setPhase('over');
      const chess = chessRef.current;
      const t = tcRef.current;
      let rating: Over['rating'];
      if (t) {
        const cls = classOf(t.base, t.inc);
        rating = { ...applyResult(cls, botElo, score), cls };
      }
      const resultTag = score === 0.5 ? '1/2-1/2' : (score === 1) === (userColor === 'w') ? '1-0' : '0-1';
      const bot = botFor(botElo);
      chess.header(
        'Event', 'Partida contra bot',
        'Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
        'White', userColor === 'w' ? 'Tú' : `${bot.name} (${botElo})`,
        'Black', userColor === 'b' ? 'Tú' : `${bot.name} (${botElo})`,
        'Result', resultTag,
        'TimeControl', t ? `${t.base}+${t.inc}` : '-',
      );
      const pgn = chess.pgn();
      const games = load<SavedGame[]>('games', []);
      save('games', [{ pgn, date: Date.now(), result: resultTag, botElo, tc: t?.label ?? 'Sin reloj', color: userColor }, ...games].slice(0, 100));
      setOver({ score, title, reason, rating });
      setTimeout(() => setShowModal(true), 450);
      if (score === 1) sound.win();
      else if (score === 0) sound.lose();
    },
    [botElo, userColor],
  );

  const checkEnd = useCallback(() => {
    const chess = chessRef.current;
    if (!chess.isGameOver()) return;
    if (chess.isCheckmate()) {
      const userWon = chess.turn() !== userColor;
      finish(userWon ? 1 : 0, userWon ? '¡Victoria!' : 'Derrota', 'por jaque mate');
    } else if (chess.isStalemate()) finish(0.5, 'Tablas', 'por rey ahogado');
    else if (chess.isThreefoldRepetition()) finish(0.5, 'Tablas', 'por triple repetición');
    else if (chess.isInsufficientMaterial()) finish(0.5, 'Tablas', 'por material insuficiente');
    else finish(0.5, 'Tablas', 'por la regla de los 50 movimientos');
  }, [finish, userColor]);

  const applyMove = useCallback(
    (m: MoveInput) => {
      const chess = chessRef.current;
      let mv;
      try {
        mv = chess.move(m);
      } catch {
        return false;
      }
      const c = clockRef.current;
      const t = tcRef.current;
      if (c && t) {
        c[mv.color] += t.inc * 1000;
        c.last = performance.now();
        setClocks({ w: c.w, b: c.b });
      }
      setFen(chess.fen());
      setSans(chess.history());
      setLastMove([mv.from, mv.to]);
      playMoveSound(mv.san);
      checkEnd();
      return true;
    },
    [checkEnd],
  );

  // Reloj
  useEffect(() => {
    if (phase !== 'playing' || !tcRef.current) return;
    const id = setInterval(() => {
      const c = clockRef.current;
      const chess = chessRef.current;
      if (!c || chess.history().length === 0) {
        if (c) c.last = performance.now();
        return;
      }
      const now = performance.now();
      const side = chess.turn();
      c[side] -= now - c.last;
      c.last = now;
      setClocks({ w: c.w, b: c.b });
      if (c[side] <= 0) {
        c[side] = 0;
        const other = side === 'w' ? 'b' : 'w';
        if (insufficientFor(chess, other)) finish(0.5, 'Tablas', 'por tiempo con material insuficiente');
        else if (side === userColor) finish(0, 'Derrota', 'por tiempo');
        else finish(1, '¡Victoria!', 'por tiempo');
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, finish, userColor]);

  // Turno del bot
  useEffect(() => {
    const chess = chessRef.current;
    if (phase !== 'playing' || chess.turn() === userColor || chess.isGameOver()) return;
    const id = gameId.current;
    const t = tcRef.current;
    const c = clockRef.current;
    let think = 600 + Math.random() * 900;
    if (t && c) {
      const left = c[chess.turn()];
      think = Math.max(150, Math.min(4000, left / 35 + t.inc * 700));
      if (chess.history().length < 6) think = Math.min(think, 600);
    }
    const t0 = performance.now();
    setThinking(true);
    engineRef.current!.botMove(chess.fen(), botElo, Math.max(100, Math.round(think * 0.8))).then((uci) => {
      const wait = Math.max(0, Math.min(think, 350) - (performance.now() - t0));
      setTimeout(() => {
        if (id !== gameId.current || phaseRef.current !== 'playing') return;
        setThinking(false);
        applyMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      }, wait);
    });
  }, [fen, phase, userColor, botElo, applyMove]);

  function start() {
    const color = settings.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.color;
    const elo = settings.adaptive ? getRating(ratingClass).rating : settings.manualElo;
    chessRef.current = new Chess();
    gameId.current++;
    tcRef.current = tc;
    clockRef.current = tc ? { w: tc.base * 1000, b: tc.base * 1000, last: performance.now() } : null;
    setClocks(tc ? { w: tc.base * 1000, b: tc.base * 1000 } : null);
    setUserColor(color);
    setBotElo(Math.round(elo));
    setFen(chessRef.current.fen());
    setSans([]);
    setLastMove(null);
    setOver(null);
    setShowModal(false);
    setThinking(false);
    setPhase('playing');
    sound.good();
  }

  function resign() {
    finish(0, 'Derrota', 'por abandono');
  }

  function undo() {
    const chess = chessRef.current;
    gameId.current++; // descarta la respuesta pendiente del bot
    chess.undo();
    if (chess.turn() !== userColor) chess.undo();
    setFen(chess.fen());
    setSans(chess.history());
    setLastMove(null);
    setThinking(false);
  }

  const bot = botFor(botElo);
  const orientation = userColor === 'w' ? 'white' : 'black';
  const botColor = userColor === 'w' ? 'b' : 'w';
  const myRating = getRating(ratingClass).rating;
  const turn = chessRef.current.turn();

  return (
    <div className="page play-page">
      <div className="board-col">
        <Clock
          ms={clocks ? clocks[botColor] : null}
          active={phase === 'playing' && turn === botColor}
          name={phase === 'setup' ? 'Rival' : `${bot.avatar} ${bot.name}${thinking ? ' · pensando…' : ''}`}
          rating={phase === 'setup' ? undefined : botElo}
          color={botColor}
        />
        <Board
          position={fen}
          orientation={orientation}
          movable={phase === 'playing' ? userColor : null}
          onMove={(m) => chessRef.current.turn() === userColor && applyMove(m)}
          lastMove={lastMove}
        />
        <Clock
          ms={clocks ? clocks[userColor] : null}
          active={phase === 'playing' && turn === userColor}
          name="Tú"
          rating={tcRef.current || phase === 'setup' ? myRating : undefined}
          color={userColor}
        />
      </div>

      <aside className="side-panel">
        {phase === 'setup' ? (
          <div className="card fade-in">
            <h2>Nueva partida</h2>
            <label className="field-label">Ritmo</label>
            <div className="chip-grid">
              {TIME_CONTROLS.map((t, i) => (
                <button key={t.label} className={`chip ${settings.tcIndex === i ? 'on' : ''}`} onClick={() => setSettings({ ...settings, tcIndex: i })}>
                  {t.label}
                </button>
              ))}
            </div>
            <p className="muted small">
              {tc ? `Puntuada · ${RATING_LABELS[ratingClass]} (tu Elo: ${myRating})` : 'Sin puntuar · puedes deshacer jugadas'}
            </p>

            <label className="field-label">Juegas con</label>
            <div className="chip-row">
              {(['w', 'random', 'b'] as const).map((c) => (
                <button key={c} className={`chip ${settings.color === c ? 'on' : ''}`} onClick={() => setSettings({ ...settings, color: c })}>
                  {c === 'w' ? '♔ Blancas' : c === 'b' ? '♚ Negras' : '🎲 Al azar'}
                </button>
              ))}
            </div>

            <label className="field-label">Rival</label>
            <div className="chip-row">
              <button className={`chip ${settings.adaptive ? 'on' : ''}`} onClick={() => setSettings({ ...settings, adaptive: true })}>
                🎯 Adaptativo
              </button>
              <button className={`chip ${!settings.adaptive ? 'on' : ''}`} onClick={() => setSettings({ ...settings, adaptive: false })}>
                🎚️ Elegir Elo
              </button>
            </div>
            {settings.adaptive ? (
              <p className="muted small">El bot juega a tu nivel ({myRating}) y se ajusta tras cada partida.</p>
            ) : (
              <div className="slider-box">
                <input type="range" min={400} max={3000} step={50} value={settings.manualElo} onChange={(e) => setSettings({ ...settings, manualElo: Number(e.target.value) })} />
                <div className="bot-preview">
                  <span className="bot-avatar">{botFor(settings.manualElo).avatar}</span>
                  <div>
                    <strong>
                      {botFor(settings.manualElo).name} · {settings.manualElo}
                    </strong>
                    <p className="muted small">{botFor(settings.manualElo).blurb}</p>
                  </div>
                </div>
              </div>
            )}
            <button className="btn primary big" onClick={start}>
              Jugar
            </button>
          </div>
        ) : (
          <div className="card fade-in">
            <div className="bot-preview">
              <span className="bot-avatar bounce">{bot.avatar}</span>
              <div>
                <strong>{bot.name}</strong>
                <p className="muted small">{bot.blurb}</p>
              </div>
            </div>
            <MoveList sans={sans} current={sans.length - 1} />
            <div className="btn-row">
              {phase === 'playing' ? (
                <>
                  {!tcRef.current && (
                    <button className="btn" onClick={undo} disabled={sans.length < 1}>
                      ↶ Deshacer
                    </button>
                  )}
                  <button className="btn danger" onClick={resign}>
                    🏳 Abandonar
                  </button>
                </>
              ) : (
                <>
                  <button className="btn primary" onClick={start}>
                    Revancha
                  </button>
                  <button className="btn" onClick={() => analyzePgn(chessRef.current.pgn())}>
                    🔍 Analizar
                  </button>
                  <button className="btn ghost" onClick={() => setPhase('setup')}>
                    Nueva
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </aside>

      {over && showModal && (
        <Modal onClose={() => setShowModal(false)}>
          {over.score === 1 && <Confetti />}
          <div className={`result-icon ${over.score === 1 ? 'win' : over.score === 0 ? 'loss' : 'draw'}`}>{over.score === 1 ? '🏆' : over.score === 0 ? '💔' : '🤝'}</div>
          <h2 className="result-title">{over.title}</h2>
          <p className="muted">{over.reason}</p>
          {over.rating && (
            <div className="rating-change">
              <span className="muted small">{RATING_LABELS[over.rating.cls]}</span>
              <span className="rating-big">
                <AnimatedNumber from={over.rating.before} to={over.rating.after} />
              </span>
              <span className={`delta ${over.rating.after >= over.rating.before ? 'up' : 'down'}`}>
                {over.rating.after >= over.rating.before ? '+' : ''}
                {over.rating.after - over.rating.before}
              </span>
            </div>
          )}
          <div className="btn-row center">
            <button className="btn primary" onClick={start}>
              Revancha
            </button>
            <button className="btn" onClick={() => analyzePgn(chessRef.current.pgn())}>
              🔍 Analizar partida
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
