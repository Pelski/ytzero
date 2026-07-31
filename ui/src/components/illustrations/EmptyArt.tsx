import { useId, type CSSProperties, type ReactNode } from "react";
import "./EmptyArt.css";

/**
 * Empty-state illustrations. One shared 220×150 stage, one accent badge, one
 * outlined "subject" per scene — see docs/illustrations.md before adding one.
 */
export type EmptyArtScene =
  | "inboxZero"
  | "scheduleClear"
  | "offAir"
  | "noDownloads"
  | "archiveEmpty"
  | "nothingLiked"
  | "noHistory"
  | "noShorts"
  | "playlistEmpty"
  | "noSubscriptions"
  | "noDiscovery"
  | "noInsights"
  | "socialEmpty";

/** Badge glyphs, authored around the fixed badge centre (110, 58). */
const GLYPH: Record<EmptyArtScene, string> = {
  inboxZero: "M102 58.5 L107.5 64 L118.5 52",
  scheduleClear: "M110 50.5 V58.5 H116",
  // The centre dot is what stops the two arcs from reading as parentheses.
  offAir: "M104 64 A9 9 0 0 1 104 52 M116 64 A9 9 0 0 1 116 52 M110 58 h0.01",
  noDownloads: "M110 50 V62 M104.5 56.5 L110 62 L115.5 56.5",
  archiveEmpty: "M103 53.5 H117 M105.5 53.5 V64 H114.5 V53.5",
  nothingLiked: "M110 65.5 C110 65.5 101.5 59.5 101.5 55.2 A4.3 4.3 0 0 1 110 53.2 A4.3 4.3 0 0 1 118.5 55.2 C118.5 59.5 110 65.5 110 65.5 Z",
  noHistory: "M102.5 57.5 A7.5 7.5 0 1 0 105 52 M102 47.5 V53.5 H108",
  noShorts: "M106 51.5 L117.5 58 L106 64.5 Z",
  playlistEmpty: "M102 52.5 H118 M102 58 H118 M102 63.5 H111",
  noSubscriptions: "M110 56 a4.2 4.2 0 1 0 0-8.4 a4.2 4.2 0 0 0 0 8.4 M101.5 66.5 a8.5 8.5 0 0 1 17 0",
  noDiscovery: "M110 48.5 L112.9 55.1 L119.5 58 L112.9 60.9 L110 67.5 L107.1 60.9 L100.5 58 L107.1 55.1 Z",
  noInsights: "M103 64.5 V57 M110 64.5 V50 M117 64.5 V60",
  socialEmpty: "M102 51.5 H118 V61 H111 L106 65 V61 H102 Z",
};

/** A video card drifting out of frame — the content that is no longer waiting. */
function Card({ id, x, y, w, h, r, rotate, opacity, play = false }: { id: string; x: number; y: number; w: number; h: number; r: number; rotate: number; opacity: number; play?: boolean }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g opacity={opacity} transform={`rotate(${rotate} ${cx} ${cy})`}>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={`url(#${id})`} stroke="currentColor" strokeOpacity=".5" strokeWidth="2" />
      {play && <path d={`M${cx - 5} ${cy - 6} L${cx + 6} ${cy} L${cx - 5} ${cy + 6} Z`} fill="currentColor" fillOpacity=".5" />}
    </g>
  );
}

function Sparkle({ x, y, size, opacity }: { x: number; y: number; size: number; opacity: number }) {
  const s = size;
  return <path d={`M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`} fill="currentColor" fillOpacity={opacity} />;
}

/** Badge + sparkles from the illustration language, without a scene subject. */
export function EmptyArtMotif({ scene, className, style }: { scene: EmptyArtScene; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className ? `empty-art-motif ${className}` : "empty-art-motif"} style={style} viewBox="0 0 72 58" fill="none" aria-hidden="true">
      <Sparkle x={8} y={13} size={5} opacity={0.32} />
      <Sparkle x={65} y={45} size={4} opacity={0.22} />
      <circle cx="36" cy="29" r="18" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeOpacity=".55" strokeWidth="2.4" />
      <path className="empty-art__glyph" d={GLYPH[scene]} transform="translate(-74 -29)" />
    </svg>
  );
}

/** The outlined object each scene sits on. Drawn last so it reads as the foreground. */
function Subject({ scene }: { scene: EmptyArtScene }) {
  switch (scene) {
    case "inboxZero":
      return <>
        <path className="empty-art__base" d="M58.5 84.5 L44 111 V125 A9 9 0 0 0 53 134 H167 A9 9 0 0 0 176 125 V111 L161.5 84.5 Z" />
        <path className="empty-art__line" d="M44 111 H84 L92 122 H128 L136 111 H176" />
      </>;
    case "scheduleClear":
      return <>
        <path className="empty-art__line" d="M84 88 V81 M136 88 V81" />
        <rect className="empty-art__base" x="62" y="88" width="96" height="46" rx="10" />
        <path className="empty-art__line" d="M62 103 H158" />
        <circle className="empty-art__dot" cx="82" cy="118" r="3.4" />
        <circle className="empty-art__dot" cx="110" cy="118" r="3.4" />
        <circle className="empty-art__dot" cx="138" cy="118" r="3.4" />
      </>;
    case "offAir":
      return <>
        <rect className="empty-art__base" x="60" y="84" width="100" height="44" rx="9" />
        <path className="empty-art__line" d="M110 128 V134 M96 135 H124" />
      </>;
    case "noDownloads":
      return <>
        <rect className="empty-art__base" x="70" y="86" width="80" height="12" rx="6" opacity=".55" />
        <rect className="empty-art__base" x="58" y="98" width="104" height="36" rx="9" />
        <path className="empty-art__line" d="M74 116 H104" />
        <circle className="empty-art__dot" cx="146" cy="116" r="3.6" />
      </>;
    case "archiveEmpty":
      return <>
        <rect className="empty-art__base" x="52" y="86" width="116" height="17" rx="5" />
        <path className="empty-art__base" d="M60 103 H160 V126 A8 8 0 0 1 152 134 H68 A8 8 0 0 1 60 126 Z" />
        <path className="empty-art__line" d="M98 117 H122" />
      </>;
    case "nothingLiked":
      return <>
        <rect className="empty-art__base" x="78" y="84" width="72" height="40" rx="8" opacity=".5" transform="rotate(-7 114 104)" />
        <rect className="empty-art__base" x="66" y="94" width="88" height="40" rx="9" />
      </>;
    case "noHistory":
      return <>
        <rect className="empty-art__base" x="52" y="94" width="116" height="40" rx="10" />
        <path className="empty-art__line" d="M68 106 H120" opacity=".5" />
        <path className="empty-art__line" d="M68 120 H152" />
        <circle className="empty-art__dot" cx="86" cy="120" r="4.5" />
        <circle className="empty-art__dot" cx="110" cy="120" r="4.5" />
        <circle className="empty-art__dot" cx="134" cy="120" r="4.5" />
      </>;
    case "noShorts":
      return <>
        <rect className="empty-art__base" x="58" y="94" width="30" height="40" rx="8" opacity=".5" />
        <rect className="empty-art__base" x="132" y="94" width="30" height="40" rx="8" opacity=".5" />
        <rect className="empty-art__base" x="95" y="84" width="30" height="50" rx="8" />
      </>;
    case "playlistEmpty":
      return <>
        <rect className="empty-art__base" x="56" y="90" width="108" height="44" rx="10" />
        <rect className="empty-art__base" x="68" y="100" width="32" height="24" rx="5" opacity=".6" />
        <path className="empty-art__line" d="M110 107 H150" />
        <path className="empty-art__line" d="M110 118 H136" opacity=".6" />
      </>;
    case "noSubscriptions":
      return <>
        <circle className="empty-art__base" cx="68" cy="113" r="15" opacity=".55" />
        <circle className="empty-art__base" cx="152" cy="113" r="15" opacity=".55" />
        <circle className="empty-art__base" cx="110" cy="110" r="19" />
      </>;
    case "noDiscovery":
      return <>
        <rect className="empty-art__base" x="62" y="92" width="96" height="42" rx="10" />
        <path className="empty-art__line" d="M102 105 L118 113 L102 121 Z" />
      </>;
    case "noInsights":
      return <>
        <path className="empty-art__line" d="M54 132 H166" />
        <rect className="empty-art__base" x="72" y="108" width="18" height="24" rx="4" />
        <rect className="empty-art__base" x="101" y="94" width="18" height="38" rx="4" />
        <rect className="empty-art__base" x="130" y="116" width="18" height="16" rx="4" />
      </>;
    case "socialEmpty":
      return <>
        <rect className="empty-art__base" x="52" y="96" width="116" height="38" rx="9" />
        <rect className="empty-art__base" x="64" y="105" width="40" height="20" rx="5" opacity=".6" />
        <path className="empty-art__line" d="M79 110 L89 115 L79 120 Z" />
        <path className="empty-art__line" d="M116 108 H154 M116 119 H141" opacity=".65" />
        <path className="empty-art__base" d="M121 83 H163 A7 7 0 0 1 170 90 V103 A7 7 0 0 1 163 110 H145 L136 117 V110 H121 A7 7 0 0 1 114 103 V90 A7 7 0 0 1 121 83 Z" />
        <path className="empty-art__line" d="M126 94 H158 M126 101 H149" opacity=".65" />
      </>;
  }
}

/** Cards and sparkles above the subject, tuned per scene so they never collide with it. */
function Atmosphere({ scene, cardId }: { scene: EmptyArtScene; cardId: string }) {
  switch (scene) {
    case "inboxZero":
      return <>
        <Card id={cardId} x={52} y={30} w={44} h={27} r={7} rotate={-11} opacity={0.4} play />
        <Card id={cardId} x={126} y={22} w={40} h={25} r={6} rotate={10} opacity={0.26} />
        <Sparkle x={34} y={68} size={8} opacity={0.38} />
        <Sparkle x={190} y={72} size={6} opacity={0.26} />
      </>;
    case "scheduleClear":
      return <>
        <Card id={cardId} x={46} y={34} w={42} h={26} r={7} rotate={-9} opacity={0.32} play />
        <Sparkle x={30} y={70} size={7} opacity={0.32} />
        <Sparkle x={192} y={66} size={6} opacity={0.24} />
      </>;
    case "offAir":
      return <>
        <Sparkle x={34} y={64} size={7} opacity={0.3} />
        <Sparkle x={188} y={70} size={6} opacity={0.24} />
      </>;
    case "noDownloads":
      return <>
        <Card id={cardId} x={48} y={32} w={42} h={26} r={7} rotate={-10} opacity={0.3} />
        <Card id={cardId} x={132} y={26} w={40} h={25} r={6} rotate={9} opacity={0.24} />
        <Sparkle x={30} y={72} size={7} opacity={0.3} />
      </>;
    case "archiveEmpty":
      return <>
        <Card id={cardId} x={50} y={28} w={42} h={26} r={7} rotate={-10} opacity={0.3} play />
        <Sparkle x={30} y={70} size={7} opacity={0.3} />
        <Sparkle x={190} y={66} size={6} opacity={0.22} />
      </>;
    case "nothingLiked":
      return <>
        <Sparkle x={36} y={66} size={8} opacity={0.34} />
        <Sparkle x={188} y={72} size={6} opacity={0.24} />
      </>;
    case "noHistory":
      return <>
        <Card id={cardId} x={46} y={32} w={42} h={26} r={7} rotate={-10} opacity={0.28} play />
        <Card id={cardId} x={134} y={26} w={40} h={25} r={6} rotate={9} opacity={0.22} />
        <Sparkle x={30} y={74} size={7} opacity={0.28} />
      </>;
    case "noShorts":
      return <>
        <Sparkle x={36} y={70} size={8} opacity={0.32} />
        <Sparkle x={186} y={66} size={6} opacity={0.24} />
      </>;
    case "playlistEmpty":
      return <>
        <Card id={cardId} x={48} y={32} w={42} h={26} r={7} rotate={-10} opacity={0.3} play />
        <Sparkle x={30} y={70} size={7} opacity={0.3} />
      </>;
    case "noSubscriptions":
      return <>
        <Sparkle x={34} y={66} size={8} opacity={0.32} />
        <Sparkle x={188} y={70} size={6} opacity={0.24} />
      </>;
    case "noDiscovery":
      return <>
        <Card id={cardId} x={46} y={30} w={42} h={26} r={7} rotate={-11} opacity={0.32} />
        <Card id={cardId} x={134} y={24} w={40} h={25} r={6} rotate={10} opacity={0.24} />
        <Sparkle x={30} y={70} size={7} opacity={0.3} />
        <Sparkle x={192} y={68} size={6} opacity={0.24} />
      </>;
    case "noInsights":
      return <>
        <Sparkle x={34} y={68} size={7} opacity={0.3} />
        <Sparkle x={188} y={72} size={6} opacity={0.22} />
      </>;
    case "socialEmpty":
      return <>
        <Card id={cardId} x={46} y={30} w={42} h={26} r={7} rotate={-10} opacity={0.3} play />
        <Sparkle x={32} y={72} size={7} opacity={0.3} />
        <Sparkle x={190} y={68} size={6} opacity={0.24} />
      </>;
  }
}

export default function EmptyArt({ scene, className }: { scene: EmptyArtScene; className?: string }): ReactNode {
  // Gradient ids must be unique per instance — two empty states can coexist
  // (e.g. a page state behind a settings panel) and would otherwise collide.
  const uid = useId().replace(/:/g, "");
  const cardId = `empty-art-card-${uid}`;
  const glowId = `empty-art-glow-${uid}`;
  return (
    <svg className={className ? `empty-art ${className}` : "empty-art"} viewBox="0 0 220 150" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={cardId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity=".05" />
        </linearGradient>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="110" cy="98" rx="88" ry="40" fill={`url(#${glowId})`} />
      <Atmosphere scene={scene} cardId={cardId} />

      <circle cx="110" cy="58" r="18" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeOpacity=".55" strokeWidth="2.4" />
      <path className="empty-art__glyph" d={GLYPH[scene]} />

      <Subject scene={scene} />
    </svg>
  );
}
