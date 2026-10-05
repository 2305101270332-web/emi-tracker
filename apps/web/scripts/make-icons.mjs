// Renders the gold-dragon emblem (src/components/dragon-geometry.json, shared with the
// <DragonEmblem> component) into the PWA icons and the SVG favicon.
// Run: npm run icons -w @emi/web
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(readFileSync(join(here, "..", "src", "components", "dragon-geometry.json"), "utf8"));
const out = join(here, "..", "public", "icons");
mkdirSync(out, { recursive: true });

const GOLD = ["#FFE9A8", "#E8C25A", "#B8860B", "#7A5808"];
const CRIMSON = ["#A11D22", "#6E0F14", "#3E0709"];

/** The emblem artwork (viewBox 0 0 64 64), optionally on a lacquer-red tile. */
export function emblemSvg({ tile, scale = 1, rounded = true }) {
  const c = g.coin;
  const art = `
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
    <circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="url(#coin)" stroke="${GOLD[3]}" stroke-width="1"/>
    <circle cx="${c.cx}" cy="${c.cy}" r="${c.inner}" fill="none" stroke="${GOLD[3]}" stroke-width="0.7" opacity="0.8"/>
    <rect x="${c.cx - c.hole / 2}" y="${c.cy - c.hole / 2}" width="${c.hole}" height="${c.hole}" fill="${CRIMSON[1]}" stroke="${GOLD[3]}" stroke-width="0.7"/>
    <g fill="${GOLD[3]}">
      <rect x="${c.cx - 0.6}" y="${c.cy - c.inner + 1}" width="1.2" height="3" rx="0.4"/>
      <rect x="${c.cx - 0.6}" y="${c.cy + c.inner - 4}" width="1.2" height="3" rx="0.4"/>
      <rect x="${c.cx - c.inner + 1}" y="${c.cy - 0.6}" width="3" height="1.2" rx="0.4"/>
      <rect x="${c.cx + c.inner - 4}" y="${c.cy - 0.6}" width="3" height="1.2" rx="0.4"/>
    </g>
    <path d="${g.spikes}" fill="${CRIMSON[0]}" stroke="${GOLD[3]}" stroke-width="0.5" stroke-linejoin="round"/>
    <path d="${g.body}" fill="none" stroke="${GOLD[3]}" stroke-width="7.4" stroke-linecap="round"/>
    <path d="${g.body}" fill="none" stroke="url(#gold)" stroke-width="5.6" stroke-linecap="round"/>
    <path d="${g.body}" fill="none" stroke="${CRIMSON[1]}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0.9 2.6" opacity="0.7"/>
    <g transform="translate(${g.tail.x} ${g.tail.y}) rotate(${g.tail.rotate})">
      <path d="${g.tailFin}" fill="url(#gold)" stroke="${GOLD[3]}" stroke-width="0.6" stroke-linejoin="round"/>
    </g>
    <g transform="translate(${g.head.x} ${g.head.y}) rotate(${g.head.rotate}) scale(${g.head.scale})">
      <path d="${g.mane}" fill="${CRIMSON[0]}" stroke="${GOLD[3]}" stroke-width="0.6" stroke-linejoin="round"/>
      <path d="${g.horn}" fill="url(#gold)" stroke="${GOLD[3]}" stroke-width="0.7" stroke-linejoin="round"/>
      <path d="${g.jaw}" fill="url(#gold)" stroke="${GOLD[3]}" stroke-width="0.8" stroke-linejoin="round"/>
      <path d="${g.headShape}" fill="url(#gold)" stroke="${GOLD[3]}" stroke-width="0.9" stroke-linejoin="round"/>
      <path d="${g.whisker}" fill="none" stroke="${GOLD[0]}" stroke-width="0.8" stroke-linecap="round"/>
      <path d="${g.whisker2}" fill="none" stroke="${GOLD[0]}" stroke-width="0.8" stroke-linecap="round"/>
      <circle cx="${g.eye.x}" cy="${g.eye.y}" r="${g.eye.r}" fill="${CRIMSON[0]}" stroke="${GOLD[3]}" stroke-width="0.4"/>
      <circle cx="${g.eye.x + 0.35}" cy="${g.eye.y - 0.35}" r="0.35" fill="#FFF6DA"/>
      <circle cx="${g.nostril.x}" cy="${g.nostril.y}" r="${g.nostril.r}" fill="${GOLD[3]}"/>
    </g>
  </g>`;
  const bg = tile
    ? `<rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="url(#lacquer)"/>
       <rect x="3" y="3" width="58" height="58" rx="${rounded ? 11.5 : 0}" fill="none" stroke="${GOLD[1]}" stroke-width="0.9" opacity="0.65"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GOLD[0]}"/><stop offset="0.45" stop-color="${GOLD[1]}"/><stop offset="1" stop-color="${GOLD[2]}"/>
    </linearGradient>
    <radialGradient id="coin" cx="0.4" cy="0.35" r="0.8">
      <stop offset="0" stop-color="${GOLD[0]}"/><stop offset="0.6" stop-color="${GOLD[1]}"/><stop offset="1" stop-color="${GOLD[2]}"/>
    </radialGradient>
    <radialGradient id="lacquer" cx="0.5" cy="0.35" r="0.85">
      <stop offset="0" stop-color="${CRIMSON[0]}"/><stop offset="0.65" stop-color="${CRIMSON[1]}"/><stop offset="1" stop-color="${CRIMSON[2]}"/>
    </radialGradient>
  </defs>${bg}${art}
</svg>`;
}

const png = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

writeFileSync(join(out, "icon.svg"), emblemSvg({ tile: true }));
writeFileSync(join(out, "emblem.svg"), emblemSvg({ tile: false }));
writeFileSync(join(out, "icon-192.png"), png(emblemSvg({ tile: true }), 192));
writeFileSync(join(out, "icon-512.png"), png(emblemSvg({ tile: true }), 512));
// Maskable: full-bleed tile, artwork inside the 80% safe zone.
writeFileSync(join(out, "maskable-512.png"), png(emblemSvg({ tile: true, rounded: false, scale: 0.78 }), 512));
writeFileSync(join(out, "apple-touch-icon.png"), png(emblemSvg({ tile: true, rounded: false, scale: 0.9 }), 180));
console.log("icons written to", out);
