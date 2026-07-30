import { useState, type CSSProperties } from "react";
import { EmptyArtMotif, type EmptyArtScene } from "../components/illustrations/EmptyArt";

const FEATURES: EmptyArtScene[] = [
  "noSubscriptions", "noDownloads", "noHistory", "noDiscovery", "playlistEmpty", "offAir",
  "scheduleClear", "noInsights", "nothingLiked", "noShorts", "archiveEmpty", "inboxZero",
];

type Zone = { x: [number, number]; y: [number, number] };
type MotifPlacement = { x: number; y: number; size: number; rotation: number; driftX: number; driftY: number; duration: number; delay: number };
type ScatterPlacement = { x: number; y: number; size: number; rotation: number; kind: "dot" | "ring" | "dash" | "plus" | "diamond" };
type TrailPlacement = { x: number; y: number; width: number; rotation: number };

// Uneven zones by design: dense upper-left and lower-middle groups, sparse right side.
const MOTIF_ZONES: Zone[] = [
  { x: [3, 18], y: [7, 24] }, { x: [8, 25], y: [23, 40] },
  { x: [27, 43], y: [3, 15] }, { x: [31, 46], y: [17, 27] },
  { x: [76, 94], y: [8, 27] }, { x: [82, 96], y: [35, 58] },
  { x: [2, 17], y: [48, 73] }, { x: [18, 34], y: [68, 88] },
  { x: [30, 45], y: [82, 93] }, { x: [56, 70], y: [79, 92] },
  { x: [72, 85], y: [67, 84] }, { x: [88, 96], y: [76, 92] },
];

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

function createLayout() {
  const motifs = MOTIF_ZONES.map<MotifPlacement>((zone) => ({
    x: randomBetween(...zone.x),
    y: randomBetween(...zone.y),
    size: randomBetween(42, 58),
    rotation: randomBetween(-12, 12),
    driftX: randomBetween(-9, 10),
    driftY: randomBetween(-14, -6),
    duration: randomBetween(9, 16),
    delay: randomBetween(-12, 0),
  }));

  const outsideForm = () => {
    for (;;) {
      const point = { x: randomBetween(2, 98), y: randomBetween(3, 96) };
      if (!(point.x > 34 && point.x < 66 && point.y > 27 && point.y < 75)) return point;
    }
  };

  const kinds: ScatterPlacement["kind"][] = ["dot", "ring", "dash", "plus", "diamond"];
  const scatter = Array.from({ length: 34 }, (_, index): ScatterPlacement => {
    const point = outsideForm();
    return {
      ...point,
      size: randomBetween(index % 5 === 0 ? 10 : 4, index % 5 === 0 ? 20 : 12),
      rotation: randomBetween(-70, 70),
      kind: kinds[Math.floor(Math.random() * kinds.length)]!,
    };
  });

  const trails = Array.from({ length: 4 }, (): TrailPlacement => {
    const point = outsideForm();
    return { ...point, width: randomBetween(80, 190), rotation: randomBetween(-45, 45) };
  });

  return { motifs, scatter, trails };
}

function motifStyle(placement: MotifPlacement): CSSProperties {
  return {
    left: `${placement.x}%`,
    top: `${placement.y}%`,
    width: `${placement.size}px`,
    maxWidth: `${placement.size}px`,
    transform: `rotate(${placement.rotation}deg)`,
    animationDuration: `${placement.duration}s`,
    animationDelay: `${placement.delay}s`,
    "--login-float-x": `${placement.driftX}px`,
    "--login-float-y": `${placement.driftY}px`,
  } as CSSProperties;
}

/** Randomized functional badges and decoration from the app's illustration family. */
export default function LoginBackdrop() {
  const [layout] = useState(createLayout);

  return (
    <div className="login-backdrop" aria-hidden="true">
      {layout.trails.map((trail, index) => (
        <svg
          key={`trail-${index}`}
          className="login-scatter-trail"
          viewBox="0 0 180 64"
          style={{ left: `${trail.x}%`, top: `${trail.y}%`, width: `${trail.width}px`, transform: `rotate(${trail.rotation}deg)` }}
        >
          <path d="M3 51C43 4 114 5 177 39" />
        </svg>
      ))}
      {layout.scatter.map((item, index) => (
        <span
          key={`scatter-${index}`}
          className={`login-scatter login-scatter--${item.kind}`}
          style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.size}px`, height: `${item.size}px`, transform: `rotate(${item.rotation}deg)` }}
        />
      ))}
      {FEATURES.map((scene, index) => (
        <EmptyArtMotif
          key={scene}
          scene={scene}
          className={`login-feature-motif${layout.motifs[index]!.y > 75 || layout.motifs[index]!.y < 25 ? " login-feature-motif--edge" : ""}`}
          style={motifStyle(layout.motifs[index]!)}
        />
      ))}
    </div>
  );
}
