import { useId } from "react";
import g from "./dragon-geometry.json";

/**
 * The gold dragon coiled around an ancient coin. Same geometry as the PWA icons
 * (scripts/make-icons.mjs). Decorative unless a `title` is given.
 */
export function DragonEmblem({ size = 40, tile = false, title, className }: { size?: number; tile?: boolean; title?: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gold = `gold-${uid}`;
  const coin = `coin-${uid}`;
  const lacquer = `lacquer-${uid}`;
  const c = g.coin;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE9A8" />
          <stop offset="0.45" stopColor="#E8C25A" />
          <stop offset="1" stopColor="#B8860B" />
        </linearGradient>
        <radialGradient id={coin} cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#FFE9A8" />
          <stop offset="0.6" stopColor="#E8C25A" />
          <stop offset="1" stopColor="#B8860B" />
        </radialGradient>
        <radialGradient id={lacquer} cx="0.5" cy="0.35" r="0.85">
          <stop offset="0" stopColor="#A11D22" />
          <stop offset="0.65" stopColor="#6E0F14" />
          <stop offset="1" stopColor="#3E0709" />
        </radialGradient>
      </defs>
      {tile && (
        <>
          <rect width="64" height="64" rx="14" fill={`url(#${lacquer})`} />
          <rect x="3" y="3" width="58" height="58" rx="11.5" fill="none" stroke="#E8C25A" strokeWidth="0.9" opacity="0.65" />
        </>
      )}
      <circle cx={c.cx} cy={c.cy} r={c.r} fill={`url(#${coin})`} stroke="#7A5808" strokeWidth="1" />
      <circle cx={c.cx} cy={c.cy} r={c.inner} fill="none" stroke="#7A5808" strokeWidth="0.7" opacity="0.8" />
      <rect x={c.cx - c.hole / 2} y={c.cy - c.hole / 2} width={c.hole} height={c.hole} fill="#6E0F14" stroke="#7A5808" strokeWidth="0.7" />
      <path d={g.spikes} fill="#A11D22" stroke="#7A5808" strokeWidth="0.5" strokeLinejoin="round" />
      <path d={g.body} fill="none" stroke="#7A5808" strokeWidth="7.4" strokeLinecap="round" />
      <path d={g.body} fill="none" stroke={`url(#${gold})`} strokeWidth="5.6" strokeLinecap="round" />
      <path d={g.body} fill="none" stroke="#6E0F14" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.9 2.6" opacity="0.7" />
      <g transform={`translate(${g.tail.x} ${g.tail.y}) rotate(${g.tail.rotate})`}>
        <path d={g.tailFin} fill={`url(#${gold})`} stroke="#7A5808" strokeWidth="0.6" strokeLinejoin="round" />
      </g>
      <g transform={`translate(${g.head.x} ${g.head.y}) rotate(${g.head.rotate}) scale(${g.head.scale})`}>
        <path d={g.mane} fill="#A11D22" stroke="#7A5808" strokeWidth="0.6" strokeLinejoin="round" />
        <path d={g.horn} fill={`url(#${gold})`} stroke="#7A5808" strokeWidth="0.7" strokeLinejoin="round" />
        <path d={g.jaw} fill={`url(#${gold})`} stroke="#7A5808" strokeWidth="0.8" strokeLinejoin="round" />
        <path d={g.headShape} fill={`url(#${gold})`} stroke="#7A5808" strokeWidth="0.9" strokeLinejoin="round" />
        <path d={g.whisker} fill="none" stroke="#FFE9A8" strokeWidth="0.8" strokeLinecap="round" />
        <path d={g.whisker2} fill="none" stroke="#FFE9A8" strokeWidth="0.8" strokeLinecap="round" />
        <circle cx={g.eye.x} cy={g.eye.y} r={g.eye.r} fill="#A11D22" stroke="#7A5808" strokeWidth="0.4" />
        <circle cx={g.eye.x + 0.35} cy={g.eye.y - 0.35} r="0.35" fill="#FFF6DA" />
        <circle cx={g.nostril.x} cy={g.nostril.y} r={g.nostril.r} fill="#7A5808" />
      </g>
    </svg>
  );
}
