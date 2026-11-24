// Einstiegspunkt. Der Worker liefert die Seite aus und hat genau eine
// Schnittstelle: /api/judge (AI-Urteil bei Grenzfällen). Gespeichert wird
// nichts, alle Daten liegen im Browser. Prüfmuster aus Lead Table.

import { judge, readInput, type AiEnv } from "./judge";

interface Env extends AiEnv {
  ASSETS: Fetcher;
  LIMITER?: RateLimit;
}

const MAX_BODY_BYTES = 4000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname !== "/api/judge") return json({ error: "Unknown endpoint." }, 404);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);

    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== url.host) return json({ error: "Cross-site requests are not allowed." }, 403);

    if (env.LIMITER) {
      const key = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.LIMITER.limit({ key });
      if (!success) return json({ error: "Too many requests. The rule score stays." }, 429);
    }

    let body: Record<string, unknown>;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "Request is too large." }, 413);
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }

    const input = readInput(body);
    if (!input) return json({ error: "Company name is missing." }, 400);
    return json(await judge(env, input));
  },
} satisfies ExportedHandler<Env>;
