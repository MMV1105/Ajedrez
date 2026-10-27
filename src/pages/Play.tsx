import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import Board, { type MoveInput } from '../components/Board';
import Clock from '../components/Clock';
import MoveList from '../components/MoveList';
import Modal from '../components/Modal';
import Confetti from '../components/Confetti';
import AnimatedNumber from '../components/AnimatedNumber';
import Icon from '../components/Icon';
import { Engine } from '../lib/engine';
import { CLASS_INFO, evalPosition, judgeMove, playerAccuracy, type Classification, type PositionEval } from '../lib/analysis';
import { applyResult, getRating, RATING_LABELS, type RatingClass } from '../lib/elo';
import { botFor } from '../lib/bots';
import { isNeutral, STYLE_PRESETS, type BotStyle } from '../lib/style';
import { playMoveSound, sound } from '../lib/sound';
import { analyzePgn } from '../lib/nav';
import { load, save } from '../lib/storage';

type TimeControl = { base: number; inc: number };
type Mode = 'bullet' | 'blitz' | 'rapid' | 'libre';

const MODES: { id: Mode; label: string; controls: TimeControl[] }[] = [
  { id: 'bullet', label: 'Bullet', controls: [{ base: 60, inc: 0 }, { base: 60, inc: 1 }, { base: 120, inc: 1 }] },
  { id: 'blitz', label: 'Blitz', controls: [{ base: 180, inc: 0 }, { base: 180, inc: 2 }, { base: 300, inc: 0 }, { base: 300, inc: 3 }] },
  { id: 'rapid', label: 'Rápidas', controls: [{ base: 600, inc: 0 }, { base: 900, inc: 10 }, { base: 1800, inc: 0 }] },
  { id: 'libre', label: 'Sin reloj', controls: [] },
];

const tcLabel = (t: TimeControl) => (t.inc ? `${t.base / 60} + ${t.inc}` : `${t.base / 60} min`);

type Settings = {
  mode: Mode;
  tc: TimeControl;
  color: 'w' | 'b' | 'random';
  adaptive: boolean;
  manualElo: number;
  styleId: string; // id de preset o 'custom'
  custom: BotStyle;
  live: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  mode: 'rapid',
  tc: { base: 600, inc: 0 },
  color: 'random',
  adaptive: true,
  manualElo: 1200,
  styleId: 'equilibrado',
  custom: { aggression: 30, trades: 0, risk: 30 },
  live: false,
};

type Over = {
  score: number; // para el usuario
  title: string;
  reason: string;
  rating?: { before: number; after: number; cls: RatingClass };
};

type Judged = { cls: Classification; accuracy: number; san: string; to: string };

export type SavedGame = { pgn: string; date: number; result: string; botElo: number; tc: string; color: 'w' | 'b' };

function insufficientFor(chess: Chess, color: 'w' | 'b') {
  const pieces = chess.board().flat().filter((p) => p && p.color === color && p.type !== 'k');
  return pieces.length === 0 || (pieces.length === 1 && (pieces[0]!.type === 'n' || pieces[0]!.type === 'b'));
}

function styleOf(s: Settings): BotStyle {
  return s.styleId === 'custom' ? s.custom : STYLE_PRESETS.find((p) => p.id === s.styleId)?.style ?? STYLE_PRESETS[0].style;
}

function styleName(s: Settings) {
  return s.styleId === 'custom' ? 'Personalizado' : STYLE_PRESETS.find((p) => p.id === s.styleId)?.name ?? 'Equilibrado';
}

export default function Play() {
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = load<Partial<Settings>>('playSettings2', {});
    return { ...DEFAULT_SETTINGS, ...saved };
  });
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
  const [judged, setJudged] = useState<Record<number, Judged>>({});
  const [live, setLive] = useState(false);
  const [gameStyle, setGameStyle] = useState<BotStyle>(STYLE_PRESETS[0].style);
  const [gameStyleName, setGameStyleName] = useState('Equilibrado');

  const chessRef = useRef(new Chess());
  const engineRef = useRef<Engine | null>(null);
  const judgeRef = useRef<Engine | null>(null);
  const evalCache = useRef(new Map<string, Promise<PositionEval>>());
  const clockRef = useRef<{ w: number; b: number; last: number } | null>(null);
  const gameId = useRef(0);
  const tcRef = useRef<TimeControl | null>(null);
  const modeRef = useRef<Mode>('rapid');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const ratingClass: RatingClass = settings.mode === 'libre' ? 'rapid' : settings.mode;

  useEffect(() => save('playSettings2', settings), [settings]);

  useEffect(() => {
    engineRef.current = new Engine();
    return () => {
      engineRef.current?.terminate();
      judgeRef.current?.terminate();
    };
  }, []);

  const evalOf = useCallback((f: string) => {
    let p = evalCache.current.get(f);
    if (!p) {
      p = evalPosition(judgeRef.current!, f, 12);
      evalCache.current.set(f, p);
    }
    return p;
  }, []);

  // Precisión en directo: evalúa cada jugada del usuario con un segundo motor.
  const judge = useCallback(
    (mv: Move, ply: number) => {
      if (!judgeRef.current) return;
      const id = gameId.current;
      Promise.all([evalOf(mv.before), evalOf(mv.after)]).then(([b, a]) => {
        if (id !== gameId.current) return;
        const r = judgeMove(mv, b, a);
        setJudged((j) => ({ ...j, [ply]: { cls: r.cls, accuracy: r.accuracy, san: mv.san, to: mv.to } }));
      });
    },
    [evalOf],
  );

  const finish = useCallback(
    (score: number, title: string, reason: string) => {
      if (phaseRef.current !== 'playing') return;
      phaseRef.current = 'over';
      setPhase('over');
      const chess = chessRef.current;
      const t = tcRef.current;
      let rating: Over['rating'];
      if (t && modeRef.current !== 'libre') {
        const cls = modeRef.current as RatingClass;
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
      save('games', [{ pgn, date: Date.now(), result: resultTag, botElo, tc: t ? tcLabel(t) : 'Sin reloj', color: userColor }, ...games].slice(0, 100));
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
      finish(userWon ? 1 : 0, userWon ? 'Has ganado' : 'Has perdido', 'por jaque mate');
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
      const ply = chess.history().length - 1;
      setFen(chess.fen());
      setSans(chess.history());
      setLastMove([mv.from, mv.to]);
      playMoveSound(mv.san);
      if (judgeRef.current) {
        if (mv.color === userColor) judge(mv, ply);
        else evalOf(mv.after); // adelanta la evaluación de la posición que tendrás que jugar
      }
      checkEnd();
      return true;
    },
    [checkEnd, judge, evalOf, userColor],
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
        else if (side === userColor) finish(0, 'Has perdido', 'por tiempo');
        else finish(1, 'Has ganado', 'por tiempo');
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
    engineRef.current!.botMove(chess.fen(), botElo, Math.max(100, Math.round(think * 0.8)), gameStyle).then((uci) => {
      const wait = Math.max(0, Math.min(think, 350) - (performance.now() - t0));
      setTimeout(() => {
        if (id !== gameId.current || phaseRef.current !== 'playing') return;
        setThinking(false);
        applyMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      }, wait);
    });
  }, [fen, phase, userColor, botElo, applyMove, gameStyle]);

  function start() {
    const color = settings.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.color;
    const elo = settings.adaptive ? getRating(ratingClass).rating : settings.manualElo;
    const tc = settings.mode === 'libre' ? null : settings.tc;
    chessRef.current = new Chess();
    gameId.current++;
    tcRef.current = tc;
    modeRef.current = settings.mode;
    clockRef.current = tc ? { w: tc.base * 1000, b: tc.base * 1000, last: performance.now() } : null;
    if (settings.live && !judgeRef.current) judgeRef.current = new Engine();
    if (!settings.live && judgeRef.current) {
      judgeRef.current.terminate();
      judgeRef.current = null;
    }
    evalCache.current.clear();
    setLive(settings.live);
    setGameStyle(styleOf(settings));
    setGameStyleName(styleName(settings));
    setJudged({});
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
    finish(0, 'Has perdido', 'por abandono');
  }

  function undo() {
    const chess = chessRef.current;
    gameId.current++; // descarta la respuesta pendiente del bot y los juicios en curso
    chess.undo();
    if (chess.turn() !== userColor) chess.undo();
    const n = chess.history().length;
    setJudged((j) => Object.fromEntries(Object.entries(j).filter(([k]) => Number(k) < n)));
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
  const judgedList = Object.values(judged);
  const liveAccuracy = judgedList.length ? playerAccuracy(judgedList.map((j) => j.accuracy)) : null;
  const lastJudged = judged[sans.length - 1] ?? judged[sans.length - 2];
  const badgeMove = judged[sans.length - 1];
  const previewStyle = styleOf(settings);

  return (
    <div className="page play-page">
      <div className="board-col">
        <Clock
          ms={clocks ? clocks[botColor] : null}
          active={phase === 'playing' && turn === botColor}
          name={phase === 'setup' ? 'Rival' : bot.name}
          rating={phase === 'setup' ? undefined : botElo}
          note={phase === 'setup' ? undefined : thinking ? 'pensando…' : gameStyleName}
          color={botColor}
        />
        <Board
          position={fen}
          orientation={orientation}
          movable={phase === 'playing' ? userColor : null}
          onMove={(m) => chessRef.current.turn() === userColor && applyMove(m)}
          lastMove={lastMove}
          badge={live && badgeMove ? { square: badgeMove.to, content: CLASS_INFO[badgeMove.cls].icon, color: CLASS_INFO[badgeMove.cls].color } : null}
        />
        <Clock
          ms={clocks ? clocks[userColor] : null}
          active={phase === 'playing' && turn === userColor}
          name="Tú"
          rating={settings.mode !== 'libre' || phase !== 'setup' ? myRating : undefined}
          color={userColor}
        />
      </div>

      <aside className="side-panel">
        {phase === 'setup' ? (
          <div className="panel fade-in">
            <h2 className="panel-title">Nueva partida</h2>

            <section className="setup-block">
              <h3 className="field-label">Ritmo</h3>
              {MODES.map((m) => (
                <div key={m.id} className={`mode-row ${settings.mode === m.id ? 'on' : ''}`}>
                  <span className="mode-name">
                    {m.label}
                    {m.id !== 'libre' && <span className="mode-elo">{getRating(m.id as RatingClass).rating}</span>}
                  </span>
                  <div className="chip-row">
                    {m.controls.length ? (
                      m.controls.map((t) => {
                        const on = settings.mode === m.id && settings.tc.base === t.base && settings.tc.inc === t.inc;
                        return (
                          <button key={tcLabel(t)} className={`chip ${on ? 'on' : ''}`} onClick={() => setSettings({ ...settings, mode: m.id, tc: t })}>
                            {tcLabel(t)}
                          </button>
                        );
                      })
                    ) : (
                      <button className={`chip ${settings.mode === 'libre' ? 'on' : ''}`} onClick={() => setSettings({ ...settings, mode: 'libre' })}>
                        Sin puntuar, con deshacer
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>

            <section className="setup-block">
              <h3 className="field-label">Color</h3>
              <div className="segmented">
                {(['w', 'random', 'b'] as const).map((c) => (
                  <button key={c} className={settings.color === c ? 'on' : ''} onClick={() => setSettings({ ...settings, color: c })}>
                    {c === 'w' ? 'Blancas' : c === 'b' ? 'Negras' : 'Al azar'}
                  </button>
                ))}
              </div>
            </section>

            <section className="setup-block">
              <h3 className="field-label">Nivel del bot</h3>
              <div className="segmented">
                <button className={settings.adaptive ? 'on' : ''} onClick={() => setSettings({ ...settings, adaptive: true })}>
                  A mi nivel ({getRating(ratingClass).rating})
                </button>
                <button className={!settings.adaptive ? 'on' : ''} onClick={() => setSettings({ ...settings, adaptive: false })}>
                  Elegir Elo
                </button>
              </div>
              {!settings.adaptive && (
                <div className="slider-field">
                  <input
                    id="manual-elo"
                    type="range"
                    min={400}
                    max={3000}
                    step={50}
                    value={settings.manualElo}
                    onChange={(e) => setSettings({ ...settings, manualElo: Number(e.target.value) })}
                  />
                  <span className="slider-value">{settings.manualElo}</span>
                </div>
              )}
              <p className="hint">
                {botFor(settings.adaptive ? getRating(ratingClass).rating : settings.manualElo).name}:{' '}
                {botFor(settings.adaptive ? getRating(ratingClass).rating : settings.manualElo).blurb}
              </p>
            </section>

            <section className="setup-block">
              <h3 className="field-label">Estilo del bot</h3>
              <div className="chip-row">
                {STYLE_PRESETS.map((p) => (
                  <button key={p.id} className={`chip ${settings.styleId === p.id ? 'on' : ''}`} onClick={() => setSettings({ ...settings, styleId: p.id })}>
                    {p.name}
                  </button>
                ))}
                <button className={`chip ${settings.styleId === 'custom' ? 'on' : ''}`} onClick={() => setSettings({ ...settings, styleId: 'custom' })}>
                  Personalizado
                </button>
              </div>
              {settings.styleId === 'custom' ? (
                <div className="style-sliders">
                  {(
                    [
                      ['aggression', 'Agresividad', 'Defensivo', 'Atacante', -100],
                      ['trades', 'Cambios de piezas', 'Los evita', 'Los busca', -100],
                      ['risk', 'Riesgo', 'Prudente', 'Temerario', 0],
                    ] as const
                  ).map(([key, label, lo, hi, min]) => (
                    <label key={key} className="style-slider" htmlFor={`style-${key}`}>
                      <span className="style-label">
                        {label} <span className="slider-value">{settings.custom[key]}</span>
                      </span>
                      <input
                        id={`style-${key}`}
                        type="range"
                        min={min}
                        max={100}
                        step={10}
                        value={settings.custom[key]}
                        onChange={(e) => setSettings({ ...settings, custom: { ...settings.custom, [key]: Number(e.target.value) } })}
                      />
                      <span className="range-ends">
                        <span>{lo}</span>
                        <span>{hi}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="hint">{STYLE_PRESETS.find((p) => p.id === settings.styleId)?.blurb}</p>
              )}
              {!isNeutral(previewStyle) && previewStyle.risk >= 60 && <p className="hint">Con mucho riesgo el bot juega por debajo de su Elo.</p>}
            </section>

            <section className="setup-block">
              <label className="toggle" htmlFor="live-accuracy">
                <input id="live-accuracy" type="checkbox" checked={settings.live} onChange={(e) => setSettings({ ...settings, live: e.target.checked })} />
                <span>
                  <strong>Precisión en directo</strong>
                  <span className="hint">Valora cada jugada tuya mientras juegas.</span>
                </span>
              </label>
            </section>

            <button className="btn primary wide" onClick={start}>
              Jugar
            </button>
          </div>
        ) : (
          <div className="panel fade-in">
            <div className="game-head">
              <span className="tag">{tcRef.current ? `${RATING_LABELS[modeRef.current as RatingClass]} · ${tcLabel(tcRef.current)}` : 'Sin reloj'}</span>
              <span className="tag">{gameStyleName}</span>
            </div>
            {live && (
              <div className="live-box">
                <div>
                  <span className="label">Tu precisión</span>
                  <span className="live-acc">{liveAccuracy === null ? '–' : liveAccuracy.toFixed(1)}</span>
                </div>
                {lastJudged && (
                  <div className="live-last" key={lastJudged.san + lastJudged.cls}>
                    <span className="cls-dot" style={{ background: CLASS_INFO[lastJudged.cls].color }}>
                      {CLASS_INFO[lastJudged.cls].icon}
                    </span>
                    {lastJudged.san} · {CLASS_INFO[lastJudged.cls].label}
                  </div>
                )}
              </div>
            )}
            <MoveList
              sans={sans}
              current={sans.length - 1}
              decorate={(i) =>
                live && judged[i] && judged[i].cls !== 'mejor' && judged[i].cls !== 'excelente' ? (
                  <span className="cls-dot tiny" style={{ background: CLASS_INFO[judged[i].cls].color }}>
                    {CLASS_INFO[judged[i].cls].icon}
                  </span>
                ) : null
              }
            />
            <div className="btn-row">
              {phase === 'playing' ? (
                <>
                  {!tcRef.current && (
                    <button className="btn" onClick={undo} disabled={sans.length < 1}>
                      <Icon name="undo" size={16} /> Deshacer
                    </button>
                  )}
                  <button className="btn" onClick={resign}>
                    <Icon name="flag" size={16} /> Abandonar
                  </button>
                </>
              ) : (
                <>
                  <button className="btn primary" onClick={start}>
                    Revancha
                  </button>
                  <button className="btn" onClick={() => analyzePgn(chessRef.current.pgn())}>
                    Analizar
                  </button>
                  <button className="btn ghost" onClick={() => setPhase('setup')}>
                    Cambiar ajustes
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </aside>

      {over && showModal && (
        <Modal onClose={() => setShowModal(false)}>
          {over.score === 1 && <Confetti count={60} />}
          <div className={`result-mark ${over.score === 1 ? 'win' : over.score === 0 ? 'loss' : 'draw'}`}>{over.score === 1 ? '1-0' : over.score === 0 ? '0-1' : '½-½'}</div>
          <h2 className="result-title">{over.title}</h2>
          <p className="muted">{over.reason}</p>
          {live && liveAccuracy !== null && (
            <p className="muted">
              Tu precisión: <strong>{liveAccuracy.toFixed(1)}</strong>
            </p>
          )}
          {over.rating && (
            <div className="rating-change">
              <span className="label">{RATING_LABELS[over.rating.cls]}</span>
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
              Analizar partida
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
