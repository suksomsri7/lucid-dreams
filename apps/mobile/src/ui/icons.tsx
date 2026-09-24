/**
 * The icon set from `ledger/design-app/_base.part` (`<symbol id="i-…">`), ported to
 * `react-native-svg` path data so components render the *same* glyphs the mockups
 * use instead of a third-party icon font that would not match.
 *
 * Every path below is copied from the `<symbol>` it is named after — not redrawn —
 * so a pixel-diff against the mockup PNGs stays meaningful.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from './tokens';

export type IconName =
  | 'moon'
  | 'book'
  | 'chart'
  | 'gear'
  | 'chevronRight'
  | 'chevronLeft'
  | 'check'
  | 'x'
  | 'play'
  | 'pause'
  | 'mic'
  | 'send'
  | 'watch'
  | 'phones'
  | 'heart'
  | 'wave'
  | 'bell'
  | 'hand'
  | 'volume'
  | 'sun'
  | 'plus'
  | 'shield'
  | 'clock'
  | 'spark'
  | 'eye'
  | 'info'
  | 'dots'
  | 'edit'
  | 'list';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  testID?: string;
}

/** `svg.i` default is 18×18 · 1.7 stroke (see `_base.part`). */
const DEFAULT_SIZE = 18;
const DEFAULT_STROKE = 1.7;

export function Icon({ name, size = DEFAULT_SIZE, color = colors.ink, strokeWidth = DEFAULT_STROKE, testID }: IconProps) {
  const common = {
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" testID={testID}>
      {renderGlyph(name, common)}
    </Svg>
  );
}

function renderGlyph(name: IconName, common: {
  fill: 'none';
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
}) {
  switch (name) {
    case 'moon':
      return <Path {...common} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />;
    case 'book':
      return (
        <>
          <Path {...common} d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <Path {...common} d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </>
      );
    case 'chart':
      return (
        <>
          <Path {...common} d="M3 3v18h18" />
          <Path {...common} d="M7 14l4-4 4 3 5-6" />
        </>
      );
    case 'gear':
      return (
        <>
          <Circle cx={12} cy={12} r={3} fill="none" stroke={common.stroke} strokeWidth={common.strokeWidth} />
          <Path
            {...common}
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
          />
        </>
      );
    case 'chevronRight':
      return <Path {...common} d="M9 18l6-6-6-6" />;
    case 'chevronLeft':
      return <Path {...common} d="M15 18l-6-6 6-6" />;
    case 'check':
      return <Path {...common} d="M20 6L9 17l-5-5" />;
    case 'x':
      return <Path {...common} d="M18 6L6 18M6 6l12 12" />;
    case 'play':
      return <Path {...common} d="M6 4l14 8-14 8z" fill={common.stroke} />;
    case 'pause':
      return (
        <>
          <Rect x={7} y={4} width={4} height={16} fill={common.stroke} />
          <Rect x={13} y={4} width={4} height={16} fill={common.stroke} />
        </>
      );
    case 'mic':
      return (
        <>
          <Rect x={9} y={2} width={6} height={12} rx={3} fill="none" stroke={common.stroke} strokeWidth={common.strokeWidth} />
          <Path {...common} d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
        </>
      );
    case 'send':
      return <Path {...common} d="M12 19V5M5 12l7-7 7 7" />;
    case 'watch':
      return (
        <>
          <Rect x={6} y={6} width={12} height={12} rx={3} fill="none" stroke={common.stroke} strokeWidth={common.strokeWidth} />
          <Path {...common} d="M9 6V3h6v3M9 18v3h6v-3" />
        </>
      );
    case 'phones':
      return (
        <>
          <Path {...common} d="M3 18v-6a9 9 0 0 1 18 0v6" />
          <Path
            {...common}
            d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"
          />
        </>
      );
    case 'heart':
      return (
        <Path
          {...common}
          d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"
        />
      );
    case 'wave':
      return <Path {...common} d="M2 12h3l3-8 4 16 4-12 2 4h4" />;
    case 'bell':
      return <Path {...common} d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />;
    case 'hand':
      return (
        <>
          <Path {...common} d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" />
          <Path
            {...common}
            d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2a8 8 0 0 1-6.4-3.2L2.7 15a2 2 0 0 1 3.3-2.3L6 14"
          />
        </>
      );
    case 'volume':
      return <Path {...common} d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />;
    case 'sun':
      return (
        <>
          <Circle cx={12} cy={12} r={4} fill="none" stroke={common.stroke} strokeWidth={common.strokeWidth} />
          <Path {...common} d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      );
    case 'plus':
      return <Path {...common} d="M12 5v14M5 12h14" />;
    case 'shield':
      return <Path {...common} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
    case 'clock':
      return (
        <>
          <Circle cx={12} cy={12} r={10} fill="none" stroke={common.stroke} strokeWidth={common.strokeWidth} />
          <Path {...common} d="M12 6v6l4 2" />
        </>
      );
    case 'spark':
      return <Path {...common} d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />;
    case 'eye':
      return (
        <>
          <Path {...common} d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
          <Circle cx={12} cy={12} r={3} fill="none" stroke={common.stroke} strokeWidth={common.strokeWidth} />
        </>
      );
    case 'info':
      return (
        <>
          <Circle cx={12} cy={12} r={10} fill="none" stroke={common.stroke} strokeWidth={common.strokeWidth} />
          <Path {...common} d="M12 16v-4M12 8h.01" />
        </>
      );
    case 'dots':
      return (
        <>
          <Circle cx={5} cy={12} r={1.5} fill={common.stroke} />
          <Circle cx={12} cy={12} r={1.5} fill={common.stroke} />
          <Circle cx={19} cy={12} r={1.5} fill={common.stroke} />
        </>
      );
    case 'edit':
      return <Path {...common} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />;
    case 'list':
      return <Path {...common} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />;
    default:
      return null;
  }
}
