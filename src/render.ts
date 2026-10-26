// 渲染层：把 Snapshot 画成 4 页 1264x1680 的 SVG，再经 resvg 转 PNG。
// 版式沿用电脑端 Pillow 版（文石 Serif CJK，大量留白，墨枝收尾）。
import { Resvg } from "@resvg/resvg-wasm";
import type { Snapshot, Health, Github } from "./data";
import { hzNow } from "./data";

const W = 1264, H = 1680;
const INK = "#1a1a1a", GRAY = "#787878", LIGHT = "#c8c8c8";
const FAM_LIGHT = "Noto Serif CJK SC Light";
const FAM_MED = "Noto Serif CJK SC Medium";
const WEEKDAYS = "一二三四五六日";

let esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 居中文本（y = baseline） */
function C(txt: string, y: number, size: number, opts: { w?: number; fill?: string } = {}) {
  const fam = (opts.w ?? 300) >= 500 ? FAM_MED : FAM_LIGHT;
  return `<text x="632" y="${y}" text-anchor="middle" font-family="${fam}" ` +
    `font-size="${size}" fill="${opts.fill ?? INK}">${esc(txt)}</text>`;
}
function rule(y: number) {
  return `<line x1="180" y1="${y}" x2="${W - 180}" y2="${y}" stroke="${LIGHT}" stroke-width="3"/>`;
}
function branch() {
  // 底部墨枝：一段大圆弧 + 五片贝塞尔叶
  const cx = W / 2, cy = 2480, r = 900;
  const a0 = (247 * Math.PI) / 180, a1 = (293 * Math.PI) / 180;
  let path = "";
  for (let i = 0; i <= 60; i++) {
    const a = a0 + ((a1 - a0) * i) / 60;
    path += (i ? "L" : "M") + (cx + r * Math.cos(a)).toFixed(1) + " " + (cy + r * Math.sin(a)).toFixed(1);
  }
  let leaves = "";
  for (const [t, side] of [[0.18, 1], [0.34, -1], [0.52, 1], [0.7, -1], [0.86, 1]]) {
    const a = a0 + (a1 - a0) * t;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    const ang = a - 1.15 * side, L = 60, Wd = 20;
    const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
    const tx = x + dx * L, ty = y + dy * L, mx = x + dx * L * 0.5, my = y + dy * L * 0.5;
    let pts = "";
    for (const sign of [1, -1]) {
      const cxp = mx + px * Wd * sign, cyp = my + py * Wd * sign;
      for (let i = 0; i < 9; i++) {
        const t2 = i / 8;
        const bx = sign == 1 ? x : tx, by = sign == 1 ? y : ty;
        const ex = sign == 1 ? tx : x, ey = sign == 1 ? ty : y;
        pts += (i || sign == -1 ? "L" : "") +
          ((1 - t2) ** 2 * bx + 2 * (1 - t2) * t2 * cxp + t2 ** 2 * ex).toFixed(1) + " " +
          ((1 - t2) ** 2 * by + 2 * (1 - t2) * t2 * cyp + t2 ** 2 * ey).toFixed(1) + " ";
      }
    }
    leaves += `<path d="M${pts}Z" fill="${INK}"/>`;
  }
  return `<path d="${path}" stroke="${INK}" stroke-width="5" fill="none"/>${leaves}`;
}
function svg(body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`;
}
function pct(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + " 亿";
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString("en-US") + " 万";
  return String(n);
}

const VERDICT: Record<string, string> = { ready: "可以练", watch: "悠着点", rest: "该休息" };

// ---------- 页1 日历 + 天气 ----------
function page1(s: Snapshot): string {
  const now = hzNow();
  const weekday = "星期" + WEEKDAYS[(now.getUTCDay() + 6) % 7];
  let body =
    C(`${now.getUTCFullYear()} 年 ${now.getUTCMonth() + 1} 月`, 162, 52, { fill: GRAY }) +
    `<text x="632" y="500" text-anchor="middle"><tspan font-family="${FAM_LIGHT}" font-size="330" fill="${INK}">${String(now.getUTCDate()).padStart(2, "0")}</tspan><tspan font-family="${FAM_MED}" font-size="68" fill="${GRAY}" dx="24">${weekday}</tspan></text>` +
    rule(660);
  const w = s.weather;
  if (w) {
    body += C(`${s.city} · ${w.cond}`, 800, 60, { w: 500 }) +
      C(`${w.cur}°`, 950, 150) +
      C(`最高 ${w.hi}°  ·  最低 ${w.lo}°`, 1075, 54, { fill: GRAY }) +
      C(`明天 ${w.tmrwCond}  ${w.tmrwHi}° / ${w.tmrwLo}°`, 1160, 54, { fill: GRAY });
  } else {
    body += C(s.city + " · 天气暂不可用", 900, 60, { fill: GRAY });
  }
  body += rule(1270) + C("·  阅  读  愉  快  ·", 1400, 46, { fill: GRAY }) + branch();
  return svg(body);
}

// ---------- 页2 Coding Plan ----------
function page2(s: Snapshot, expireDate: string): string {
  const u = s.usage;
  let body = C("Z · CODING PLAN", 220, 50, { fill: GRAY });
  if (u) {
    body += C(`GLM Coding Plan${u.level ? " · " + u.level : ""}`, 360, 62, { w: 500 }) +
      C(`${u.pct5}%`, 770, 340) +
      C("5 小时窗口已用", 900, 54, { fill: GRAY });
    const bw = 900, bx = (W - bw) / 2, by = 990;
    const fillw = Math.max(22, (bw * Math.min(u.pct5, 100)) / 100);
    body += `<rect x="${bx}" y="${by}" width="${bw}" height="22" rx="11" fill="${LIGHT}"/>` +
      `<rect x="${bx}" y="${by}" width="${fillw.toFixed(1)}" height="22" rx="11" fill="${INK}"/>` +
      rule(1140) +
      C(`近 7 天  ${u.tokens7} tokens`, 1240, 66, { w: 500 }) +
      C(`${u.calls7.toLocaleString("en-US")} 次调用`, 1330, 54, { fill: GRAY });
    const days = expireDays(expireDate);
    if (days !== null) {
      const txt = days < 0 ? "已到期" : days === 0 ? "今天到期" : `剩 ${days} 天到期`;
      body += C(txt, 1430, 50, { fill: GRAY });
    }
  } else {
    body += C("用量暂不可用", 840, 60, { fill: GRAY });
  }
  body += branch();
  return svg(body);
}

function expireDays(expireDate: string): number | null {
  if (!expireDate) return null;
  const exp = new Date(expireDate + "T00:00:00Z");
  if (isNaN(exp.getTime())) return null;
  const today = new Date(hzNow().toISOString().slice(0, 10) + "T00:00:00Z");
  return Math.round((exp.getTime() - today.getTime()) / 86400_000);
}

// ---------- 页3 HAE Pulse ----------
function page3(h: Health | null): string {
  let body = C("HAE PULSE · 今日恢复", 200, 50, { fill: GRAY });
  if (!h) {
    body += C("数据暂不可用", 820, 60, { fill: GRAY }) + branch();
    return svg(body);
  }
  body += C(VERDICT[h.verdict] ?? h.verdict, 480, 190);
  const ds = h.hrv_delta_pct == null ? "—" : (h.hrv_delta_pct > 0 ? "+" : "") + h.hrv_delta_pct + "%";
  body += C(`HRV ${h.hrv_today ?? "—"} · 基线 ${h.hrv_avg7 ?? "—"} · ${ds}`, 620, 58, { w: 500 });

  // HRV 7 日柱状 + 基线虚线
  const series = (h.hrv_series ?? []).slice(-7);
  if (series.length) {
    const bx0 = 260, bx1 = W - 260, top = 720, bot = 960;
    const gap = (bx1 - bx0) / series.length, bw = gap * 0.52;
    const vmax = Math.max(...series.map((p) => p.value), h.hrv_avg7 ?? 0) || 1;
    for (let i = 0; i < series.length; i++) {
      const x = bx0 + gap * i + (gap - bw) / 2;
      const bh = (bot - top) * (series[i].value / vmax);
      const today = i === series.length - 1;
      body += `<rect x="${x.toFixed(1)}" y="${(bot - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${today ? INK : GRAY}"/>`;
      body += `<text x="${(x + bw / 2).toFixed(1)}" y="${bot + 52}" text-anchor="middle" font-family="${FAM_LIGHT}" font-size="36" fill="${GRAY}">${series[i].day.slice(5).replace("-", "/")}</text>`;
    }
    if (h.hrv_avg7) {
      const by = bot - (bot - top) * (h.hrv_avg7 / vmax);
      body += `<line x1="${bx0}" y1="${by.toFixed(1)}" x2="${bx1}" y2="${by.toFixed(1)}" stroke="${GRAY}" stroke-width="3" stroke-dasharray="14 10"/>`;
    }
  }
  body += rule(1080);
  const sleep = h.sleep;
  const rows: [string, string][] = [
    ["静息心率", `${h.rhr_today ?? "—"}  (基线 ${h.rhr_avg7 ?? "—"})`],
    ["心肺耐力(估)", `${h.vo2max ?? "—"}`],
    ["睡眠", sleep ? `${sleep.total_hr}h · 深睡 ${sleep.deep_hr}h` : "—"],
    ["体重", h.weight],
    ["今日锻炼", `${h.exercise_min_today}/${h.exercise_goal} 分`],
    ["步数", `${h.steps_today}`],
  ];
  rows.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? 150 : 782;
    const y = 1140 + Math.floor(i / 2) * 130;
    body += `<text x="${x}" y="${y}" font-family="${FAM_LIGHT}" font-size="40" fill="${GRAY}">${esc(k)}</text>` +
      `<text x="${x}" y="${y + 50}" font-family="${FAM_MED}" font-size="48" fill="${INK}">${esc(v)}</text>`;
  });
  body += branch();
  return svg(body);
}

// ---------- 页4 GitHub ----------
function page4(g: Github | null): string {
  let body = C("GITHUB · 编码足迹", 200, 50, { fill: GRAY });
  if (!g || (g.total == null && !g.cells.length)) {
    body += C("数据暂不可用", 820, 60, { fill: GRAY }) + branch();
    return svg(body);
  }
  body += C(String(g.total ?? "—"), 600, 320) + C("近一年贡献", 710, 54, { fill: GRAY });

  // 连续天数：从最近一天往前数 level>0（今天为 0 不算断）
  let streak = 0;
  for (let i = g.cells.length - 1; i >= 0; i--) {
    const [date, lv] = g.cells[i];
    if (lv > 0) streak++;
    else {
      if (date === g.cells[g.cells.length - 1][0]) continue;
      break;
    }
  }
  const todayS = g.today == null ? "—" : String(g.today);
  body += C(`连续编码 ${streak} 天 · 今日 ${todayS} 次提交`, 820, 58, { w: 500 }) + rule(920);

  // 热力图：最近 18 周
  const shades = ["#ebebeb", "#b9b9b9", "#7d7d7d", "#464646", "#1a1a1a"];
  const cells = g.cells.slice(-18 * 7);
  while (cells.length % 7) cells.unshift(["", 0]);
  const weeks: ([string, number] | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const sq = 24, gap = 10, pitch = sq + gap;
  const x0 = (W - (weeks.length * pitch - gap)) / 2, y0 = 990;
  weeks.forEach((week, wi) => {
    week.forEach((cell, di) => {
      const x = x0 + wi * pitch, y = y0 + di * pitch;
      if (!cell) body += `<rect x="${x}" y="${y}" width="${sq}" height="${sq}" fill="none" stroke="${LIGHT}" stroke-width="2"/>`;
      else body += `<rect x="${x}" y="${y}" width="${sq}" height="${sq}" fill="${shades[cell[1]] ?? shades[0]}"/>`;
    });
  });
  body += branch();
  return svg(body);
}

// ---------- 栅格化 ----------
export interface Fonts { light: ArrayBuffer; medium: ArrayBuffer }
let fonts: Fonts | null = null;

export function setFonts(f: Fonts) {
  fonts = {
    light: new Uint8Array(f.light),
    medium: new Uint8Array(f.medium),
  };
}

export function renderPages(s: Snapshot, expireDate: string): Uint8Array[] {
  const svgs = [page1(s), page2(s, expireDate), page3(s.health), page4(s.github)];
  return svgs.map((svgStr, i) => {
    try {
      const resvg = new Resvg(svgStr, {
        fitTo: { mode: "original" },
        font: {
          fontBuffers: [fonts!.light, fonts!.medium],
          loadSystemFonts: false,
          defaultFontFamily: FAM_LIGHT,
        },
      });
      const png = resvg.render().asPng();
      return new Uint8Array(png);
    } catch (e) {
      const name = (e as any)?.constructor?.name ?? typeof e;
      throw new Error(
        `[page${i + 1}] ${name}: ${String(e).slice(0, 200)} | svgLen=${svgStr.length}`);
    }
  });
}

export { page1, page2, page3, page4 };
