import { initWasm, Resvg } from "@resvg/resvg-wasm";
// workerd 禁止从字节数组实例化 wasm，必须走编译期模块导入
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { getSnapshot } from "./data";
import { renderPages, setFonts } from "./render";

interface Env {
  STANDBY: KVNamespace;
  ZAI_API_KEY: string;
  HAE_READ_KEY: string;
  CITY: string;
  LAT: string;
  LON: string;
  GITHUB_USER: string;
  EXPIRE_DATE: string;
  CRON_TOKEN: string;
}

let initP: Promise<void> | null = null;
async function ensureResvg(env: Env) {
  initP ??= (async () => {
    const [light, medium] = await Promise.all([
      env.STANDBY.get("font-light", "arrayBuffer"),
      env.STANDBY.get("font-medium", "arrayBuffer"),
    ]);
    if (!light || !medium) throw new Error("KV 缺少字体");
    await initWasm(resvgWasm);
    setFonts({ light, medium });
  })();
  return initP;
}

function dump(e: unknown): string {
  if (e instanceof Error) return `${e.message}\n${e.stack ?? ""}`;
  const name = (e as any)?.constructor?.name ?? typeof e;
  const msg = (() => {
    try { return String(e); } catch { return "[unstringifiable]"; }
  })();
  try { return `${name}: ${msg} ${JSON.stringify(e)}`; } catch { return `${name}: ${msg}`; }
}

async function refresh(env: Env): Promise<string> {
  const stages: string[] = [];
  try {
    await ensureResvg(env);
    stages.push("resvg-init ok");
  } catch (e) {
    throw new Error(`[resvg-init] ${dump(e)}`);
  }
  let snap;
  try {
    snap = await getSnapshot(env);
    stages.push(`data ok w=${!!snap.weather} u=${!!snap.usage} h=${!!snap.health} g=${!!snap.github}`);
  } catch (e) {
    throw new Error(`[data] ${dump(e)}`);
  }
  let pngs: Buffer[];
  try {
    pngs = renderPages(snap, env.EXPIRE_DATE);
    stages.push(`render ok ${pngs.map((p) => p.length).join("/")}`);
  } catch (e) {
    throw new Error(`[render] ${dump(e)} @ stages: ${stages.join(" | ")}`);
  }
  try {
    for (let i = 0; i < pngs.length; i++) {
      await env.STANDBY.put(`page${i + 1}.png`, pngs[i]);
    }
    const meta = { fetchedAt: snap.fetchedAt, stages: stages.join(" | ") };
    await env.STANDBY.put("meta", JSON.stringify(meta));
  } catch (e) {
    throw new Error(`[kv] ${dump(e)}`);
  }
  return JSON.stringify({ ok: true, stages: stages.join(" | ") });
}

export default {
  // 定时：全量抓取 + 渲染 + 写 KV
  async scheduled(_ctrl, env: Env) {
    await refresh(env);
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // 手动触发刷新（需 CRON_TOKEN）
    if (url.pathname === "/refresh" && req.method === "POST") {
      if (req.headers.get("X-Token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const meta = await refresh(env);
        return new Response(meta, { headers: { "content-type": "application/json" } });
      } catch (e: any) {
        const detail = e instanceof Error
          ? `${e.message}\n${e.stack ?? ""}`
          : JSON.stringify(e, Object.getOwnPropertyNames(e ?? {}), 2) ?? String(e);
        return new Response(`ERROR: ${detail}`, {
          status: 500,
          headers: { "content-type": "text/plain" },
        });
      }
    }

    if (url.pathname === "/random.png" || /^\/page[1-4]\.png$/.test(url.pathname)) {
      let key = url.pathname.slice(1);
      if (key === "random.png") key = `page${1 + Math.floor(Math.random() * 4)}.png`;
      const png = await env.STANDBY.get(key, "arrayBuffer");
      if (!png) return new Response("not rendered yet", { status: 503 });
      return new Response(png, {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/") {
      const meta = await env.STANDBY.get("meta");
      return new Response(meta ?? "{}", {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
