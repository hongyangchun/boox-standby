// 数据抓取层：天气 / Z.ai 用量 / HAE 健康 / GitHub 足迹
// 全部在 Cloudflare Worker 内执行，设备端零网络依赖。

export interface Snapshot {
  date: string;
  fetchedAt: string;
  city: string;
  weather: Weather | null;
  usage: Usage | null;
  health: Health | null;
  github: Github | null;
}

export interface Weather {
  cur: number; cond: string; hi: number; lo: number;
  tmrwCond: string; tmrwHi: number; tmrwLo: number;
}
export interface Usage {
  pct5: number; tokens7: string; calls7: number; level: string;
}
export interface Health {
  hrv_today: number | null; hrv_avg7: number | null; hrv_delta_pct: number | null;
  hrv_series: { day: string; value: number }[];
  rhr_today: number | null; rhr_avg7: number | null;
  sleep: { total_hr: number; deep_hr: number } | null;
  vo2max: number | null;
  weight: string;
  exercise_min_today: number; exercise_goal: number;
  steps_today: number; verdict: string;
}
export interface Github {
  cells: [string, number][]; total: number | null; today: number | null;
}

// ---- 杭州墙上时间（Workers 是 UTC，+8 偏移后用 getUTC* 读墙上字段）----
export function hzNow(): Date {
  return new Date(Date.now() + 8 * 3600_000);
}
export function hzDate(d: Date = hzNow()): string {
  return d.toISOString().slice(0, 10);
}
function shiftDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
}
function naive(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function j(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 60)}`);
  return r.json();
}

// ---------- 天气 ----------
const WMO: Record<number, string> = {
  0: "晴", 1: "晴", 2: "多云", 3: "阴", 45: "雾", 48: "雾",
  51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
  66: "冻雨", 67: "冻雨", 71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
  80: "阵雨", 81: "阵雨", 82: "强阵雨", 85: "阵雪", 86: "阵雪",
  95: "雷雨", 96: "雷雨冰雹", 99: "雷雨冰雹",
};

export async function getWeather(lat: string, lon: string): Promise<Weather | null> {
  try {
    const d = await j(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&timezone=auto&forecast_days=2`);
    const w = (i: number) => WMO[d.daily.weather_code[i] ?? 0] ?? "—";
    return {
      cur: Math.round(d.current.temperature_2m),
      cond: w(0), hi: Math.round(d.daily.temperature_2m_max[0]),
      lo: Math.round(d.daily.temperature_2m_min[0]),
      tmrwCond: w(1), tmrwHi: Math.round(d.daily.temperature_2m_max[1]),
      tmrwLo: Math.round(d.daily.temperature_2m_min[1]),
    };
  } catch { return null; }
}

// ---------- Z.ai 用量 ----------
function fmtTokens(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + " 亿";
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString() + " 万";
  return String(n);
}

export async function getUsage(key: string): Promise<Usage | null> {
  if (!key) return null;
  try {
    const h = { Authorization: `Bearer ${key}` };
    const quota = await j("https://api.z.ai/api/monitor/usage/quota/limit", { headers: h });
    const now = hzNow();
    const start = shiftDays(now, -7); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(now.getTime()); end.setUTCHours(23, 59, 59, 999);
    const q = (s: string) => encodeURIComponent(s);
    const u7 = await j(
      `https://api.z.ai/api/monitor/usage/model-usage` +
      `?startTime=${q(naive(start))}&endTime=${q(naive(end))}`, { headers: h });
    let pct5 = 0;
    for (const lim of quota?.data?.limits ?? []) {
      if (lim.type === "TOKENS_LIMIT") pct5 = lim.percentage ?? 0;
    }
    const t7 = u7?.data?.totalUsage ?? {};
    return {
      pct5,
      tokens7: fmtTokens(t7.totalTokensUsage ?? 0),
      calls7: t7.totalModelCallCount ?? 0,
      level: (quota?.data?.level ?? "").toUpperCase(),
    };
  } catch { return null; }
}

// ---------- HAE 健康（移植自 hae-pulse collector.py）----------
const HAE = "https://hae.qiaclass.com";

export async function getHealth(key: string): Promise<Health | null> {
  if (!key) return null;
  try {
    const H = { "api-key": key, "User-Agent": "boox-standby/1.0", Accept: "application/json" };
    const T = hzDate();
    const T13 = hzDate(shiftDays(hzNow(), -13));
    const T45 = hzDate(shiftDays(hzNow(), -45));
    const T6 = hzDate(shiftDays(hzNow(), -6));
    const get = (path: string, params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return j(`${HAE}${path}?${qs}`, { headers: H });
    };
    const series = async (name: string, from: string, to: string, convert?: string) => {
      const p: Record<string, string> = { name, from, to };
      if (convert) p.convert = convert;
      const pts = (await get("/api/query", p)).points ?? [];
      const m: Record<string, number> = {};
      for (const pt of pts) if (pt.qty != null) m[pt.date] = pt.qty;
      return m;
    };
    const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
    const latest = (hist: Record<string, number>) => {
      const ds = Object.keys(hist).sort().reverse();
      return ds.length ? [ds[0], hist[ds[0]]] : [null, null];
    };
    const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

    const hrv = await series("heart_rate_variability", T13, T);
    const rhr = await series("resting_heart_rate", T13, T);
    const steps = await series("step_count", T6, T);
    const kcal = await series("active_energy", T6, T, "kcal");

    const hrvToday = hrv[T] ?? null;
    const hrvBase = mean(Object.entries(hrv).filter(([d]) => d < T).slice(-7).map(([, v]) => v));
    const delta = hrvToday != null && hrvBase ? (hrvToday - hrvBase) / hrvBase * 100 : null;

    const [rhrDay, rhrToday] = latest(rhr);
    const rhrBase = mean(
      Object.entries(rhr).filter(([d]) => rhrDay && d < rhrDay).slice(-7).map(([, v]) => v));

    const out: Health = {
      hrv_today: r1(hrvToday), hrv_avg7: r1(hrvBase),
      hrv_delta_pct: delta == null ? null : Math.round(delta * 10) / 10,
      hrv_series: Object.entries(hrv).filter(([d]) => d >= T6)
        .sort().map(([day, value]) => ({ day, value: Math.round(value * 10) / 10 })),
      rhr_today: rhrToday == null ? null : Math.round(rhrToday),
      rhr_avg7: r1(rhrBase),
      sleep: null, vo2max: null, weight: "—",
      exercise_min_today: 0, exercise_goal: 30,
      steps_today: Math.round(steps[T] ?? 0),
      verdict: "ready",
    };

    try {
      const pts = (await get("/api/query", { name: "sleep_analysis", from: T6, to: T })).points ?? [];
      const nights = pts.filter((p: any) => (p.total ?? p.qty ?? 0) >= 1.0)
        .sort((a: any, b: any) => a.date.localeCompare(b.date));
      if (nights.length) {
        const n = nights[nights.length - 1];
        out.sleep = {
          total_hr: Math.round((n.total ?? 0) * 10) / 10,
          deep_hr: Math.round((n.deep ?? 0) * 10) / 10,
        };
      }
    } catch { /* 忽略单指标失败 */ }

    try {
      const wt = await series("weight_body_mass", T45, T);
      const ds = Object.keys(wt).sort();
      if (ds.length) {
        const wd = ds[ds.length - 1];
        const suffix = wd === T ? "" : ` · ${wd.slice(5)}`;
        out.weight = wt[wd].toFixed(1) + " kg" + suffix;
      }
    } catch { /* 忽略 */ }

    try {
      const est = await get("/api/query", { name: "vo2_max_est", from: T13, to: T });
      const byday: Record<string, any> = {};
      for (const p of est.points ?? []) if (p.qty != null) byday[p.date] = p;
      const days = Object.keys(byday).sort();
      if (days.length) {
        const day = days.includes(T) ? T : days[days.length - 1];
        out.vo2max = Math.round(byday[day].qty * 10) / 10;
      }
    } catch { /* 忽略 */ }

    const workouts = await get("/api/workouts", { from: T6, to: T });
    const list: any[] = Array.isArray(workouts) ? workouts : workouts.workouts ?? [];
    const todayRows = list.filter((w) => w.day === T);
    out.exercise_min_today = Math.round(todayRows.reduce((a, w) => a + (w.duration_min || 0), 0));

    const delta2 = out.hrv_delta_pct;
    out.verdict = delta2 == null || delta2 >= -5 ? "ready" : delta2 >= -15 ? "watch" : "rest";
    return out;
  } catch { return null; }
}

// ---------- GitHub 足迹 ----------
export async function getGithub(user: string): Promise<Github | null> {
  try {
    const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/126 Safari/537.36" };
    const html = await (await fetch(`https://github.com/users/${user}/contributions`, { headers: UA })).text();
    const cells: Record<string, number> = {};
    for (const [, date, lv] of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d)"/g))
      cells[date] = Number(lv);
    for (const [, lv, date] of html.matchAll(/data-level="(\d)"[^>]*data-date="(\d{4}-\d{2}-\d{2})"/g))
      cells[date] = Number(lv);
    const totalM = html.match(/(\d+)\s+contributions\s+in the last year/);

    let today: number | null = null;
    try {
      const ev = await j(`https://api.github.com/users/${user}/events/public?per_page=60`, { headers: UA });
      const T = hzDate();
      if (Array.isArray(ev)) {
        today = 0;
        for (const e of ev) {
          const d = new Date(e.created_at + "Z");
          if (e.type === "PushEvent" && hzDate(new Date(d.getTime() + 8 * 3600_000)) === T)
            today += e.payload?.size ?? 0;
        }
      }
    } catch { /* 今日提交数可选 */ }

    return {
      cells: Object.entries(cells).sort().map(([date, lv]) => [date, lv] as [string, number]),
      total: totalM ? Number(totalM[1]) : null,
      today,
    };
  } catch { return null; }
}

// ---------- 汇总 ----------
export async function getSnapshot(env: any): Promise<Snapshot> {
  const [weather, usage, health, github] = await Promise.all([
    getWeather(env.LAT, env.LON),
    getUsage(env.ZAI_API_KEY),
    getHealth(env.HAE_READ_KEY),
    getGithub(env.GITHUB_USER),
  ]);
  return {
    date: hzDate(), fetchedAt: new Date().toISOString(),
    city: env.CITY, weather, usage, health, github,
  };
}
