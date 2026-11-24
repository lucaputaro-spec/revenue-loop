import { describe, expect, it } from "vitest";
import { createBudget } from "../public/lib/budget.js";
import { demoData } from "../public/lib/demo.js";
import { buildLookalikeList, MAX_LOOKALIKES, MIN_SIMILARITY } from "../public/lib/lookalike.js";
import { similarity } from "../public/lib/score.js";
import { inState } from "../public/lib/transitions.js";
import { TO_WON, walk } from "./helpers";

function wonDemo() {
  const d = demoData();
  const lead = d.leads.find((l) => l.listId === "list-a")!;
  return { d, won: walk(lead, TO_WON, 18000) };
}

describe("lookalike list", () => {
  it("builds a child list of list-a without the seed or any listed company", () => {
    const { d, won } = wonDemo();
    const r = buildLookalikeList(won, d, d.lists, createBudget());
    if (!r.ok) throw new Error(r.reason);
    expect(r.list.parentListId).toBe("list-a");
    expect(r.list.seedCompanyId).toBe(won.companyId);
    expect(r.list.segment).toBe(won.segment);
    expect(r.list.name).toContain("from list-a");
    expect(r.list.companyIds).not.toContain(won.companyId);
    const listed = new Set(d.lists.flatMap((l) => l.companyIds));
    for (const id of r.list.companyIds) expect(listed.has(id)).toBe(false);
    expect(r.list.companyIds.length).toBeGreaterThan(0);
    expect(r.list.companyIds.length).toBeLessThanOrEqual(MAX_LOOKALIKES);
    expect(r.leads.every((l) => inState(l, "list_built") && l.listId === r.list.id)).toBe(true);
  });

  it("sorts by similarity to the seed, all at or above the threshold", () => {
    const { d, won } = wonDemo();
    const r = buildLookalikeList(won, d, d.lists, createBudget());
    if (!r.ok) throw new Error(r.reason);
    const seed = d.companies.find((c) => c.id === won.companyId)!;
    const sims = r.list.companyIds.map((id) => similarity(seed, d.companies.find((c) => c.id === id)!));
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
    expect(Math.min(...sims)).toBeGreaterThanOrEqual(MIN_SIMILARITY);
  });

  it("charges one lookup per company against the new list", () => {
    const { d, won } = wonDemo();
    const b = createBudget();
    const r = buildLookalikeList(won, d, d.lists, b);
    if (!r.ok) throw new Error(r.reason);
    expect(b.ledger().every((e) => e.listId === r.list.id && e.kind === "company_lookup")).toBe(true);
    expect(b.ledger()).toHaveLength(r.list.companyIds.length);
  });

  it("builds no list when the budget is used up", () => {
    const { d, won } = wonDemo();
    const b = createBudget(0.05);
    const r = buildLookalikeList(won, d, d.lists, b);
    expect(r).toMatchObject({ ok: false, reason: "budget" });
    expect(b.ledger()).toEqual([]);
  });

  it("only accepts a won lead as seed", () => {
    const d = demoData();
    expect(buildLookalikeList(d.leads[0]!, d, d.lists, createBudget())).toEqual({ ok: false, reason: "not-won" });
  });
});
