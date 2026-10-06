import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "../lib/format";
import { cx } from "./ui";

/*
 * Lightweight SVG charts (no chart library). Conventions: one y-axis, recessive grid,
 * thin marks (2px lines, 4px rounded bar ends, 2px gaps between stacked segments),
 * legend for 2+ series, hover + keyboard tooltips, and a data-table view for
 * screen readers and print. Colours come from the --chart-* design tokens.
 */

const C1 = "rgb(var(--chart-1))";
const C2 = "rgb(var(--chart-2))";
const GRID = "rgb(var(--chart-grid))";

function useWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** 0, nice step… up to >= max (3–5 ticks). */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x - 80, 0), width - 170);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-[170px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card"
      style={{ left, top: Math.max(0, y - 8), transform: "translateY(-100%)" }}
    >
      {children}
    </div>
  );
}

function DataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: string[][] }) {
  const { t } = useTranslation();
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted hover:text-fg">{t("charts.showTable")}</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} scope="col" className={cx("py-1 font-semibold text-muted", i ? "text-right" : "text-left")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} className="border-t border-line">
                {r.map((c, i) => (
                  <td key={i} className={cx("num py-1", i ? "text-right" : "text-left")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const PAD = { top: 12, right: 8, bottom: 26, left: 64 };
const HEIGHT = 220;

/** Stacked bars per year: principal (bottom) + interest (top). */
export function PrincipalInterestChart({ rows, currency }: { rows: { billedDate: string; principal: number; interest: number; prepayment?: number }[]; currency: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  const titleId = useId();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const years = useMemo(() => {
    const map = new Map<string, { year: string; principal: number; interest: number }>();
    for (const r of rows) {
      const y = r.billedDate.slice(0, 4);
      const e = map.get(y) ?? { year: y, principal: 0, interest: 0 };
      e.principal += Math.max(0, r.principal + (r.prepayment ?? 0));
      e.interest += Math.max(0, r.interest);
      map.set(y, e);
    }
    return [...map.values()];
  }, [rows]);
  if (!years.length) return null;

  const max = Math.max(...years.map((y) => y.principal + y.interest));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / years.length;
  const barW = Math.max(4, Math.min(36, slot * 0.6));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(years.length / Math.max(1, Math.floor(plotW / 44)));
  const m = (v: number) => f.money(v, currency);
  const compact = (v: number) => f.moneyShort(v, currency);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min(years.length - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? years.length) - 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  return (
    <figure aria-labelledby={titleId}>
      <figcaption id={titleId} className="sr-only">
        {t("charts.principalVsInterest")}
      </figcaption>
      <Legend items={[{ label: t("charts.principal"), color: C1 }, { label: t("charts.interest"), color: C2 }]} />
      <div ref={ref} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${t("charts.principalVsInterest")}. ${t("charts.principalVsInterestDesc")}`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tk)} y2={y(tk)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tk)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px]">
                {compact(tk)}
              </text>
            </g>
          ))}
          {years.map((yr, i) => {
            const cx0 = PAD.left + slot * i + slot / 2;
            const pTop = y(yr.principal);
            const iTop = y(yr.principal + yr.interest);
            const gap = yr.interest > 0 && yr.principal > 0 ? 2 : 0;
            return (
              <g key={yr.year} onMouseEnter={() => setActive(i)} opacity={active === null || active === i ? 1 : 0.55}>
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                <rect x={cx0 - barW / 2} y={pTop} width={barW} height={Math.max(0, y(0) - pTop)} fill={C1} rx={yr.interest > 0 ? 0 : 4} />
                {yr.interest > 0 && (
                  <path
                    d={roundedTop(cx0 - barW / 2, iTop, barW, Math.max(0, pTop - iTop - gap), 4)}
                    fill={C2}
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={cx0} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[10px]">
                    {yr.year}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="rgb(var(--muted))" strokeWidth={1} />
        </svg>
        {active !== null && years[active] && (
          <Tooltip x={PAD.left + slot * active + slot / 2} y={y(years[active]!.principal + years[active]!.interest)} width={width}>
            <p className="mb-1 font-semibold">{years[active]!.year}</p>
            <p className="flex justify-between gap-2">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: C1 }} />
                {t("charts.principal")}
              </span>
              <span className="num">{m(years[active]!.principal)}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: C2 }} />
                {t("charts.interest")}
              </span>
              <span className="num">{m(years[active]!.interest)}</span>
            </p>
          </Tooltip>
        )}
      </div>
      <DataTable
        caption={t("charts.principalVsInterest")}
        headers={[t("charts.year"), t("charts.principal"), t("charts.interest")]}
        rows={years.map((yr) => [yr.year, m(yr.principal), m(yr.interest)])}
      />
    </figure>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Outstanding balance over time: a single 2px line with a soft area, crosshair tooltip. */
export function BalanceChart({ points, currency, label }: { points: { date: string; value: number }[]; currency: string; label?: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  const titleId = useId();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return null;

  const max = Math.max(...points.map((p) => p.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]! || 1;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const m = (v: number) => f.money(v, currency);
  const years = points.map((p, i) => ({ i, year: p.date.slice(0, 4) })).filter((p, idx, arr) => idx === 0 || p.year !== arr[idx - 1]!.year);
  const labelEvery = Math.ceil(years.length / Math.max(1, Math.floor(plotW / 48)));
  const title = label ?? t("charts.balanceTrend");

  const onMove = (clientX: number, rectLeft: number) => {
    const rel = clientX - rectLeft - PAD.left;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round((rel / plotW) * (points.length - 1)))));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? points.length) - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(points.length - 1);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  return (
    <figure aria-labelledby={titleId}>
      <figcaption id={titleId} className="sr-only">
        {title}
      </figcaption>
      <div ref={ref} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${title}. ${t("charts.balanceTrendDesc")}`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect().left)}
          onMouseLeave={() => setActive(null)}
          onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect().left)}
          className="block touch-pan-y rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tk)} y2={y(tk)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tk)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px]">
                {f.moneyShort(tk, currency)}
              </text>
            </g>
          ))}
          <path d={area} fill={C1} opacity={0.12} />
          <path d={line} fill="none" stroke={C1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {years.map(
            (yr, idx) =>
              idx % labelEvery === 0 && (
                <text key={yr.year} x={x(yr.i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[10px]">
                  {yr.year}
                </text>
              ),
          )}
          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} stroke="rgb(var(--muted))" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={x(active)} cy={y(points[active]!.value)} r={5} fill={C1} stroke="rgb(var(--surface))" strokeWidth={2} />
            </g>
          )}
        </svg>
        {active !== null && (
          <Tooltip x={x(active)} y={y(points[active]!.value)} width={width}>
            <p className="font-semibold">{f.monthLabel(points[active]!.date)}</p>
            <p className="num">
              {t("charts.outstanding")}: {m(points[active]!.value)}
            </p>
          </Tooltip>
        )}
      </div>
      <DataTable caption={title} headers={[t("charts.month"), t("charts.outstanding")]} rows={points.map((p) => [f.monthLabel(p.date), m(p.value)])} />
    </figure>
  );
}

/**
 * Monthly cash flow: stacked bars of EMIs (bottom) + fixed costs (top), a solid income line and a
 * dashed "breathing room" line at income − target. Bars under the dashed line leave enough over.
 */
export function CashflowChart({
  months,
  income,
  target,
  currency,
  from,
}: {
  months: { month: string; emis: number; expenses: number; left: number }[];
  income: number;
  target: number;
  currency: string;
  /** Index of the first breathing-room month, marked on the chart. */
  from: number | null;
}) {
  const { t } = useTranslation();
  const f = useFormat();
  const titleId = useId();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  if (!months.length) return null;

  const OK = "rgb(var(--success))";
  const max = Math.max(income, ...months.map((m) => m.emis + m.expenses));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / months.length;
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v: number) => PAD.top + plotH - (Math.max(0, v) / top) * plotH;
  const monthLabel = (ym: string) => f.monthLabel(`${ym}-01`);
  const axisFmt = new Intl.DateTimeFormat(f.locale, { month: "short", year: "2-digit", timeZone: "UTC" });
  const axisLabel = (ym: string) => axisFmt.format(new Date(`${ym}-01T00:00:00Z`));
  const labelEvery = Math.ceil(months.length / Math.max(1, Math.floor(plotW / 52)));
  const m = (v: number) => f.money(v, currency);
  const line = income - target;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min(months.length - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? months.length) - 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };
  const a = active !== null ? months[active] : undefined;

  return (
    <figure aria-labelledby={titleId}>
      <figcaption id={titleId} className="sr-only">
        {t("charts.cashflow")}
      </figcaption>
      <Legend
        items={[
          { label: t("charts.emis"), color: C1 },
          { label: t("charts.fixedCosts"), color: C2 },
          { label: t("charts.income"), color: "rgb(var(--fg))" },
          { label: t("charts.breathingLine"), color: OK },
        ]}
      />
      <div ref={ref} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${t("charts.cashflow")}. ${t("charts.cashflowDesc")}`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onMouseLeave={() => setActive(null)}
          className="block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tk)} y2={y(tk)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tk)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px]">
                {f.moneyShort(tk, currency)}
              </text>
            </g>
          ))}
          {from !== null && from > 0 && (
            <rect x={PAD.left + slot * from} y={PAD.top} width={plotW - slot * from} height={plotH} fill={OK} opacity={0.08} />
          )}
          {months.map((mo, i) => {
            const cx0 = PAD.left + slot * i + slot / 2;
            const eTop = y(mo.emis);
            const xTop = y(mo.emis + mo.expenses);
            const gap = mo.emis > 0 && mo.expenses > 0 ? 1 : 0;
            return (
              <g key={mo.month} onMouseEnter={() => setActive(i)} opacity={active === null || active === i ? 1 : 0.55}>
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                {mo.emis > 0 && <rect x={cx0 - barW / 2} y={eTop} width={barW} height={Math.max(0, y(0) - eTop)} fill={C1} />}
                {mo.expenses > 0 && <path d={roundedTop(cx0 - barW / 2, xTop, barW, Math.max(0, eTop - xTop - gap), 3)} fill={C2} />}
                {i % labelEvery === 0 && (
                  <text x={cx0} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[10px]">
                    {axisLabel(mo.month)}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={y(income)} y2={y(income)} stroke="rgb(var(--fg))" strokeWidth={2} />
          {line > 0 && <line x1={PAD.left} x2={width - PAD.right} y1={y(line)} y2={y(line)} stroke={OK} strokeWidth={2} strokeDasharray="6 4" />}
          <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} stroke="rgb(var(--muted))" strokeWidth={1} />
        </svg>
        {a && (
          <Tooltip x={PAD.left + slot * active! + slot / 2} y={y(Math.max(a.emis + a.expenses, income))} width={width}>
            <p className="mb-1 font-semibold">{monthLabel(a.month)}</p>
            <p className="flex justify-between gap-2">
              <span>{t("charts.emis")}</span>
              <span className="num">{m(a.emis)}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span>{t("charts.fixedCosts")}</span>
              <span className="num">{m(a.expenses)}</span>
            </p>
            <p className={cx("flex justify-between gap-2 font-semibold", a.left >= target ? "text-success" : a.left < 0 ? "text-danger" : "")}>
              <span>{t("charts.left")}</span>
              <span className="num">{m(a.left)}</span>
            </p>
          </Tooltip>
        )}
      </div>
      <DataTable
        caption={t("charts.cashflow")}
        headers={[t("charts.month"), t("charts.emis"), t("charts.fixedCosts"), t("charts.left")]}
        rows={months.map((mo) => [monthLabel(mo.month), m(mo.emis), m(mo.expenses), m(mo.left)])}
      />
    </figure>
  );
}
