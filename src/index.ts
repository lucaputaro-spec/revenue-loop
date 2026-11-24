// Einstiegspunkt. Der Worker liefert die Seite aus und hat genau eine
// Schnittstelle: /api/judge (AI-Urteil bei Grenzfällen). Gespeichert wird nichts.

interface Env {
  ASSETS: Fetcher;
}

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
    return json({ error: "Unknown endpoint." }, 404);
  },
} satisfies ExportedHandler<Env>;
