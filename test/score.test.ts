import { describe, expect, it } from "vitest";
import { createBudget, MAX_AI_CALLS } from "../public/lib/budget.js";
import type { Company } from "../public/lib/demo.js";
import { scoreCompany, scoreList, type Score } from "../public/lib/score.js";

const won: Company = {
  id: "w1", name: "Brightdesk", domain: "brightdesk.example", industry: "SaaS", employees: 40, country: "DE",
  motion: "Sales-led", fundingStage: "Series B", description: "B2B software", websiteStatus: "valid",
};
const company = (over: Partial<Company>): Company => ({ ...won, id: "c1", name: "Nordsoft", domain: "nordsoft.example", ...over });
// Gleiche Branche und gleiches Land, sonst nichts: Ähnlichkeit 0,5, Score 6.
const borderline = company({ employees: 400, motion: "Product-led", fundingStage: "Seed" });

function asScore(r: Awaited<ReturnType<typeof scoreCompany>>): Score {
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("company score", () => {
  it("names the must rule that rejects a company", async () => {
    const r = asScore(await scoreCompany(company({ country: "FR" }), [won], createBudget()));
    expect(r).toMatchObject({ score: null, rejected: true, rule: "country-in-DACH" });
    expect(r.reason).toContain("country-in-DACH");
    const agency = asScore(await scoreCompany(company({ industry: "Agency" }), [won], createBudget()));
    expect(agency.rule).toBe("not-agency");
  });

  it("gives an exact copy of a won customer a 10", async () => {
    const r = asScore(await scoreCompany(company({}), [won], createBudget()));
    expect(r.score).toBe(10);
    expect(r.source).toBe("Rule");
    expect(r.reason).toContain("Brightdesk");
  });

  it("charges one company lookup per score", async () => {
    const b = createBudget();
    await scoreCompany(company({}), [won], b, { listId: "list-a" });
    expect(b.ledger()).toEqual([{ seq: 1, kind: "company_lookup", listId: "list-a", cents: 3 }]);
  });

  it("keeps the rule score for a borderline case without a judge", async () => {
    const r = asScore(await scoreCompany(borderline, [won], createBudget()));
    expect(r.score).toBe(6);
    expect(r.source).toBe("Rule");
    expect(r.note).toContain("no AI judge");
  });

  it("caps the AI adjustment at one point", async () => {
    const r = asScore(await scoreCompany(borderline, [won], createBudget(), { judgeFn: async () => ({ adjust: 5, reason: "very close" }) }));
    expect(r.score).toBe(7);
    expect(r.source).toBe("Workers AI");
    const down = asScore(await scoreCompany(borderline, [won], createBudget(), { judgeFn: async () => ({ adjust: -4 }) }));
    expect(down.score).toBe(5);
  });

  it("does not ask the AI outside the borderline band", async () => {
    let asked = 0;
    await scoreCompany(company({}), [won], createBudget(), { judgeFn: async () => ((asked += 1), { adjust: 1 }) });
    expect(asked).toBe(0);
  });

  it("falls back to the rule when the judge throws", async () => {
    const r = asScore(await scoreCompany(borderline, [won], createBudget(), { judgeFn: async () => { throw new Error("offline"); } }));
    expect(r).toMatchObject({ score: 6, source: "Rule" });
    expect(r.note).toContain("not available");
  });

  it("falls back with a note once the AI call limit is used up", async () => {
    const b = createBudget();
    for (let i = 0; i < MAX_AI_CALLS; i++) b.charge("ai_judgment", "list-a");
    let asked = 0;
    const r = asScore(await scoreCompany(borderline, [won], b, { judgeFn: async () => ((asked += 1), { adjust: 1 }) }));
    expect(r).toMatchObject({ score: 6, source: "Rule" });
    expect(r.note).toContain("AI call limit");
    expect(asked).toBe(0);
  });

  it("refuses a whole list up front when the budget is too small", async () => {
    const b = createBudget(0.05);
    const r = await scoreList([company({}), company({ id: "c2" }), company({ id: "c3" })], [won], b);
    expect(r).toMatchObject({ ok: false, reason: "budget" });
    expect(b.ledger()).toEqual([]);
  });
});
