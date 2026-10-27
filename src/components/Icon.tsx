// Iconos de trazo sencillos (24x24) para la navegación y los botones.
const PATHS: Record<string, string> = {
  home: 'M4 11 12 4l8 7M6 9.5V20h12V9.5',
  play: 'M12 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM9.5 20l1-8h3l1 8M7 20h10',
  analyze: 'M4 19h16M5 15l4-5 3 3 6-7',
  profile: 'M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM5 20c.8-3.5 3.5-5.5 7-5.5s6.2 2 7 5.5',
  puzzle: 'M5 5h5v2a1.5 1.5 0 0 0 3 0V5h5v5h-2a1.5 1.5 0 0 0 0 3h2v5h-5v-2a1.5 1.5 0 0 0-3 0v2H5Z',
  target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  memory: 'M4 4h7v7H4ZM13 4h7v7h-7ZM4 13h7v7H4ZM13 13h7v7h-7Z',
  book: 'M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1ZM12 6v14',
  sound: 'M4 10v4h4l5 4V6L8 10ZM16 9c1.3 1.6 1.3 4.4 0 6M18.5 7c2.6 2.8 2.6 7.2 0 10',
  mute: 'M4 10v4h4l5 4V6L8 10ZM16.5 9.5l5 5M21.5 9.5l-5 5',
  flag: 'M6 21V4M6 4h11l-2 4 2 4H6',
  undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2',
  flip: 'M7 4v16M7 4 4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3',
  first: 'M6 5v14M18 5l-8 7 8 7',
  prev: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  last: 'M18 5v14M6 5l8 7-8 7',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6Z',
  back: 'M10 6l-6 6 6 6M4 12h16',
};

export default function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
