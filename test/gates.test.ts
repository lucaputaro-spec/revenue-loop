import { describe, expect, it } from "vitest";
import { createBudget } from "../public/lib/budget.js";
import { demoData, type Company, type Contact, type List } from "../public/lib/demo.js";
import { campaignGate, canStart, checkEmails, listGate, personGate, runGates, type GateResult, type GateReport } from "../public/lib/gates.js";
import { MUST_RULES, type Score } from "../public/lib/score.js";

const base: Company = {
  id: "", name: "", domain: "", industry: "SaaS", employees: 100, country: "DE",
  motion: "Sales-led", fundingStage: "Series A", description: "", websiteStatus: "valid",
};
function companies(validCount: number, total: number): { list: List; companies: Company[] } {
  const cs = Array.from({ length: total }, (_, i) => ({
    ...base, id: `c${i}`, name: `Co${i}`, domain: `co${i}.example`, websiteStatus: (i < validCount ? "valid" : "invalid") as Company["websiteStatus"],
  }));
  return { list: { id: "list-x", name: "X", segment: "S", parentListId: null, seedCompanyId: null, companyIds: cs.map((c) => c.id) }, companies: cs };
}
function gate(r: ReturnType<typeof listGate>): GateResult {
  if (!("gate" in r)) throw new Error(r.reason);
  return r;
}
const contacts = (hits: number, total: number): Contact[] =>
  Array.from({ length: total }, (_, i) => ({
    id: `p${i}`, companyId: `c${i}`, firstName: "Anna", lastName: "Keller", title: i < hits ? "VP Sales" : "Office Manager", emailStatus: "valid",
  }));
const score = (companyId: string): Score => ({
  ok: true, companyId, score: 8, rejected: false, rule: null, reason: "", source: "Rule", note: "", similarity: 0.8, nearestId: "w1",
});
const campaign = { id: "camp-1", name: "C", listId: "list-x", subject: "Hi {{companyName}}", body: "Hi {{firstName}}" };

describe("list gate", () => {
  it("passes at 7 of 10 valid websites", () => {
    const { list, companies: cs } = companies(7, 10);
    const r = gate(listGate(list, cs, MUST_RULES, createBudget()));
    expect(r.pass).toBe(true);
    expect(r.summary).toBe("list gate: 70% valid, needs 70%");
  });

  it("fails at 6 of 10 and says by how much", () => {
    const { list, companies: cs } = companies(6, 10);
    const r = gate(listGate(list, cs, MUST_RULES, createBudget()));
    expect(r.pass).toBe(false);
    expect(r.summary).toBe("list gate: 60% valid, needs 70%");
    expect(r.failures).toHaveLength(4);
  });

  it("fails when a company breaks a must rule", () => {
    const { list, companies: cs } = companies(10, 10);
    cs[0] = { ...cs[0]!, country: "FR" };
    const r = gate(listGate(list, cs, MUST_RULES, createBudget()));
    expect(r.pass).toBe(false);
    expect(r.failures[0]?.reason).toContain("country-in-DACH");
  });

  it("charges one company lookup per company", () => {
    const { list, companies: cs } = companies(10, 10);
    const b = createBudget();
    listGate(list, cs, MUST_RULES, b);
    expect(b.spentCents()).toBe(30);
  });
});

describe("person gate", () => {
  it("fails at 7 of 10 in target roles", () => {
    const r = gate(personGate(contacts(7, 10), ["VP Sales"], 42, createBudget()));
    expect(r.pass).toBe(false);
    expect(r.value).toBe(0.7);
  });

  it("passes at 8 of 10 and samples the same people for the same seed", () => {
    expect(gate(personGate(contacts(8, 10), ["VP Sales"], 42, createBudget())).pass).toBe(true);
    const a = gate(personGate(contacts(9, 30), ["VP Sales"], 7, createBudget()));
    const b = gate(personGate(contacts(9, 30), ["VP Sales"], 7, createBudget()));
    expect(a).toEqual(b);
  });
});

describe("campaign gate", () => {
  it("names the lead that misses {{firstName}}", () => {
    const leads = [
      { id: "lead-1", companyId: "c1", vars: { firstName: "Anna", companyName: "Co1" } },
      { id: "lead-X", companyId: "c2", vars: { firstName: "", companyName: "Co2" } },
    ];
    const r = campaignGate(campaign, leads, { c1: score("c1"), c2: score("c2") });
    expect(r.pass).toBe(false);
    expect(r.failures).toEqual([{ id: "lead-X", reason: "missing variable firstName" }]);
  });

  it("blocks an unscored company", () => {
    const leads = [{ id: "lead-1", companyId: "c1", vars: { firstName: "Anna", companyName: "Co1" } }];
    const r = campaignGate(campaign, leads, {});
    expect(r.pass).toBe(false);
    expect(r.failures).toEqual([{ id: "lead-1", reason: "company not scored" }]);
  });
});

describe("start decision", () => {
  it("refuses to start with a red gate and lists the reason", () => {
    const report: GateReport = {
      id: "rep-1", campaignId: "camp-1", listId: "list-b", pass: false,
      gates: [{ gate: "list", pass: false, value: 0.6, threshold: 0.7, failures: [], summary: "list gate: 60% valid, needs 70%" }],
    };
    expect(canStart(report)).toEqual({ ok: false, reasons: ["list gate: 60% valid, needs 70%"] });
    expect(canStart(null).ok).toBe(false);
  });

  it("blocks list B of the demo on the list gate", () => {
    const d = demoData();
    const listB = d.lists[1]!;
    const r = runGates({ id: "rep-1", campaign: { ...d.campaign, listId: listB.id }, list: listB, companies: d.companies, contacts: d.contacts, leads: d.leads, scores: {}, targetRoles: d.targetRoles }, createBudget());
    if (!r.ok) throw new Error(r.reason);
    expect(canStart(r.report).reasons[0]).toBe("list gate: 40% valid, needs 70%");
  });

  it("refuses the whole run up front when the budget is too small", () => {
    const d = demoData();
    const b = createBudget(0.1);
    const r = runGates({ id: "rep-1", campaign: d.campaign, list: d.lists[0]!, companies: d.companies, contacts: d.contacts, leads: d.leads, scores: {}, targetRoles: d.targetRoles }, b);
    expect(r).toMatchObject({ ok: false, reason: "budget" });
    expect(b.ledger()).toEqual([]);
  });

  it("checks emails as evidence for verified", () => {
    const d = demoData();
    const leads = d.leads.filter((l) => l.listId === "list-a");
    const b = createBudget();
    const r = checkEmails(leads, d.contacts, b);
    if (!r.ok) throw new Error(r.reason);
    expect(r.results.filter((x) => x.emailCheck === "invalid")).toHaveLength(1);
    expect(b.spentCents()).toBe(leads.length);
  });
});
