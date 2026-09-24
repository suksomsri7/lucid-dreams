/**
 * Lucid Dream design tokens — the only file allowed to contain a hex color
 * (APP-RUN §0.2 rule 7 needs its Thai twin in i18n; oracle U3 needs this one:
 * `scripts/qc-L1.2.sh` greps every `#rrggbb` in `src/ui` + `app` and fails if any
 * value is not listed here).
 *
 * Every value below is copied byte-for-byte from `ledger/design-app/_base.part`
 * (the CSS `:root` block + the `.night` overrides + the `.frame.m` background
 * gradients) — that file is the single source of truth for the look, this file
 * is its TypeScript mirror. If a number here disagrees with `_base.part`,
 * `_base.part` is right and this file has a bug.
 */

// ---------------------------------------------------------------------------
// Color — light (`:root`) and night (`.night` overrides) palettes
// ---------------------------------------------------------------------------

/** Flat ink / accent colors — same hex in both light and night mode. */
export const colors = {
  stage: '#eef0f5',

  ink: '#111318',
  ink2: '#5b6170',
  mut: '#8b91a0',

  glass: 'rgba(255,255,255,0.62)',
  glass2: 'rgba(255,255,255,0.42)',
  glass3: 'rgba(255,255,255,0.82)',
  glassLine: 'rgba(255,255,255,0.75)',

  acc: '#6b5cff',
  accBg: 'rgba(107,92,255,0.14)',
  accSurface: 'rgba(107,92,255,0.85)',
  accSurfaceSoft: 'rgba(107,92,255,0.16)',

  rem: '#0e9f7a',
  remBg: 'rgba(14,159,122,0.14)',

  dg: '#d9483b',
  dgBg: 'rgba(217,72,59,0.14)',

  night: '#0b0f1a',

  priSurface: 'rgba(17,19,24,0.88)',
  ghostSurface: 'rgba(255,255,255,0.42)', // == glass2, kept named for buttons
  hairline: 'rgba(17,19,24,0.07)',
  track: 'rgba(17,19,24,0.10)',
  white: '#ffffff',
} as const;

/**
 * `.night` cascade, resolved: `_base.part` defines the night overrides for
 * `.card`/`.btn`/`.chip` twice (once near the frame rules, once at the bottom
 * under the "night screen" comment block) — the later block wins in CSS, so these are the
 * bottom-block values, which is what actually renders.
 */
export const night = {
  bg: '#0b0f1a',
  bgBottom: '#0e1426',
  text: '#f2f4f8',
  sub: '#aab2c5',
  mut: '#6b7488',
  card: '#131a2b',
  cardBorder: 'rgba(255,255,255,0.09)',
  btn: '#1a2235',
  btnDg: 'rgba(255,107,107,0.16)',
  btnDgText: '#ff6b6b',
  chipBorder: 'rgba(255,255,255,0.16)',
  chipText: '#aab2c5',
  chipRemBg: 'rgba(94,230,192,0.14)',
  chipRemText: '#5ee6c0',
  glassBg: 'rgba(255,255,255,0.08)',
  glassBorder: 'rgba(255,255,255,0.16)',
  orbCore: 'rgba(94,230,192,0.45)',
  orbMid: 'rgba(94,230,192,0.1)',
} as const;

// ---------------------------------------------------------------------------
// Radius — the six named radii from the WO contract + the extras _base.part
// actually uses (bubble tail, switch pill, composer capsule …)
// ---------------------------------------------------------------------------

export const radius = {
  card: 24,
  plan: 26,
  btn: 25,
  chip: 18,
  tab: 32,
  frame: 46,
  // extras used by components not named in the six above, still from _base.part
  bubble: 20,
  bubbleTail: 8,
  composer: 28,
  scaleChip: 12,
  seg: 18,
  segItem: 15,
  switchPill: 15,
  notif: 24,
  icon: 20,
} as const;

// ---------------------------------------------------------------------------
// Spacing — 4px rhythm used across every mockup gap/padding
// ---------------------------------------------------------------------------

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  smd: 10,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// ---------------------------------------------------------------------------
// Type scale
// ---------------------------------------------------------------------------

export const typeScale = {
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 }, // h1.big
  h2: { fontSize: 15, fontWeight: '700' as const },
  label: { fontSize: 11.5, fontWeight: '500' as const, letterSpacing: 0.2 }, // .lbl
  sub: { fontSize: 12.5, fontWeight: '400' as const }, // .sub
  body: { fontSize: 14.5, fontWeight: '400' as const },
  button: { fontSize: 15.5, fontWeight: '600' as const },
  buttonBig: { fontSize: 17, fontWeight: '600' as const },
  chip: { fontSize: 13, fontWeight: '400' as const },
  chipSm: { fontSize: 12, fontWeight: '400' as const },
  num: { fontSize: 40, fontWeight: '700' as const, letterSpacing: -0.8 }, // orb .c b
  eventTime: { fontSize: 12.5, fontWeight: '400' as const },
} as const;

// ---------------------------------------------------------------------------
// Background gradients — `AppBackground` / `NightBackground` render these
// with `react-native-svg` (radial blobs match `.frame.m` / `.frame.m.night`
// in `_base.part` almost exactly; percentages are the CSS radial-gradient
// center points, `r` is chosen so the blob covers roughly the same share of
// a 390×844 frame that the fixed-px CSS blob does).
// ---------------------------------------------------------------------------

export interface GradientBlob {
  /** Radial gradient center, percent of the surface's bounding box. */
  cx: string;
  cy: string;
  /** Radial gradient radius, percent of the surface's bounding box. */
  r: string;
  /** Solid hex — `react-native-svg`'s `<Stop>` fades it out via `opacity`, not an rgba string. */
  color: string;
  opacity: number;
};

export interface BackgroundSpec {
  /** Linear base, top → bottom. */
  linearFrom: string;
  linearTo: string;
  blobs: GradientBlob[];
}

/** The three CSS `rgba(...)` blob colors as solid hex, alpha split out into `opacity`. */
const blobLavender = '#c4baff'; // rgba(196,186,255,·)
const blobSky = '#add6ff'; // rgba(173,214,255,·)
const blobPeach = '#ffd6cc'; // rgba(255,214,204,·)

/** DESIGN §2.8 / `.frame.m` — lavender / sky-blue / peach blobs on a near-white base. */
export const appBackground: BackgroundSpec = {
  linearFrom: '#f6f5fb',
  linearTo: '#eef1f8',
  blobs: [
    { cx: '15%', cy: '8%', r: '45%', color: blobLavender, opacity: 0.75 },
    { cx: '95%', cy: '30%', r: '42%', color: blobSky, opacity: 0.7 },
    { cx: '40%', cy: '100%', r: '45%', color: blobPeach, opacity: 0.65 },
  ],
};

/** `.frame.m.night` — accent-violet / mint blobs (same hex as `colors.acc` / `colors.rem`) on the deep-blue night base. */
export const nightBackground: BackgroundSpec = {
  linearFrom: night.bg,
  linearTo: night.bgBottom,
  blobs: [
    { cx: '20%', cy: '10%', r: '45%', color: colors.acc, opacity: 0.35 },
    { cx: '90%', cy: '70%', r: '42%', color: colors.rem, opacity: 0.22 },
  ],
};

// ---------------------------------------------------------------------------
// Shadows — `--gshadow` (light) / night card shadow
// ---------------------------------------------------------------------------

export const shadow = {
  glass: {
    shadowColor: 'rgba(40,40,90,1)',
    shadowOpacity: 0.1,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  night: {
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;
