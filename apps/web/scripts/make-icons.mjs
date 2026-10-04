// Generates PWA icons (any + maskable + apple-touch) and an SVG favicon with no
// image dependencies: a tiny supersampled rasteriser + PNG encoder on node:zlib.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const DARK = hex("#023E8A");
const BLUE = hex("#0077B6");
const LIGHT = hex("#CAF0F8");
const ORANGE = hex("#FF7A00");
const WHITE = [255, 255, 255];

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Colour at normalised (x,y) in [0,1]; null = transparent. `s` scales artwork about the centre. */
function shade(x, y, { rounded, s }) {
  const bgRadius = rounded ? 0.22 : 0;
  if (!inRoundRect(x, y, 0, 0, 1, 1, bgRadius)) return null;
  const t = y;
  let c = DARK.map((d, i) => Math.round(d + (BLUE[i] - d) * t));
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;
  if (inRoundRect(u, v, 0.2, 0.24, 0.8, 0.76, 0.07)) {
    c = WHITE;
    if (v < 0.36) c = LIGHT;
    if (inRoundRect(u, v, 0.29, 0.45, 0.6, 0.505, 0.025)) c = BLUE;
    if (inRoundRect(u, v, 0.29, 0.56, 0.5, 0.615, 0.025)) c = BLUE;
  }
  if (inCircle(u, v, 0.72, 0.71, 0.16)) c = ORANGE;
  if (inCircle(u, v, 0.72, 0.71, 0.06)) c = WHITE;
  return c;
}

function render(size, opts) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxx = 0; pxx < size; pxx++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((pxx + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (py * size + pxx) * 4;
      const n = SS * SS;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, size, px);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(out, "icon-192.png"), render(192, { rounded: true, s: 1 }));
writeFileSync(join(out, "icon-512.png"), render(512, { rounded: true, s: 1 }));
// Maskable: full-bleed background, artwork inside the 80% safe zone.
writeFileSync(join(out, "maskable-512.png"), render(512, { rounded: false, s: 0.78 }));
writeFileSync(join(out, "apple-touch-icon.png"), render(180, { rounded: false, s: 0.9 }));

writeFileSync(
  join(out, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#023E8A"/><stop offset="1" stop-color="#0077B6"/></linearGradient></defs>
<rect width="100" height="100" rx="22" fill="url(#g)"/>
<rect x="20" y="24" width="60" height="52" rx="7" fill="#fff"/>
<path d="M27 24h46a7 7 0 0 1 7 7v5H20v-5a7 7 0 0 1 7-7z" fill="#CAF0F8"/>
<rect x="29" y="45" width="31" height="5.5" rx="2.5" fill="#0077B6"/>
<rect x="29" y="56" width="21" height="5.5" rx="2.5" fill="#0077B6"/>
<circle cx="72" cy="71" r="16" fill="#FF7A00"/><circle cx="72" cy="71" r="6" fill="#fff"/>
</svg>
`,
);
console.log("icons written to", out);
