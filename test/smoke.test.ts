import { describe, expect, it } from "vitest";
import worker from "../src/index";

const assets = { fetch: async () => new Response("page") } as unknown as Fetcher;
const call = (req: Request) => worker.fetch(req as Parameters<typeof worker.fetch>[0], { ASSETS: assets });

describe("worker skeleton", () => {
  it("serves page files from assets", async () => {
    const res = await call(new Request("https://demo.test/"));
    expect(await res.text()).toBe("page");
  });

  it("answers unknown api paths with 404", async () => {
    const res = await call(new Request("https://demo.test/api/nothing", { method: "POST" }));
    expect(res.status).toBe(404);
  });
});
