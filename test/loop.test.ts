import { describe, expect, it } from "vitest";
import { createBudget } from "../public/lib/budget.js";
import { demoData } from "../public/lib/demo.js";
import { canStart, checkEmails, runGates } from "../public/lib/gates.js";
import { buildLookalikeList } from "../public/lib/lookalike.js";
import { revenueReport } from "../public/lib/report.js";
import { scoreList, type Score } from "../public/lib/score.js";
import { applyTransition, inState, type Lead } from "../public/lib/transitions.js";
import { AT, step } from "./helpers";

describe("closed loop on the demo", () => {
  it("goes from list-a through gates and a won deal to a new lookalike list with revenue on list-a", async () => {
    const d = demoData();
    const budget = createBudget();
    const listA = d.lists[0]!;
    const companiesA = listA.companyIds.map((id) => d.companies.find((c) => c.id === id)!);

    const scored = await scoreList(companiesA, d.wonCustomers, budget, { listId: listA.id });
    if (!scored.ok) throw new Error(scored.reason);
    const scores: Record<string, Score> = Object.fromEntries(scored.scores.map((s) => [s.companyId, s]));

    const gates = runGates({ id: "rep-1", campaign: d.campaign, list: listA, companies: d.companies, contacts: d.contacts, leads: d.leads, scores, targetRoles: d.targetRoles }, budget);
    if (!gates.ok) throw new Error(gates.reason);
    const start = canStart(gates.report);
    expect(start).toEqual({ ok: true, reasons: [] });

    let leads: Lead[] = d.leads;
    const replace = (l: Lead) => (leads = leads.map((x) => (x.id === l.id ? l : x)));

    const emails = checkEmails(leads.filter((l) => l.listId === listA.id), d.contacts, budget);
    if (!emails.ok) throw new Error(emails.reason);
    for (const e of emails.results) {
      const r = applyTransition(leads.find((l) => l.id === e.leadId)!, "verified", { emailCheck: e.emailCheck }, AT);
      if (r.ok) replace(r.lead);
    }
    const verified = leads.filter((l) => l.listId === listA.id && inState(l, "verified"));
    expect(verified.length).toBe(listA.companyIds.length - 1);
    for (const l of verified) replace(step(l, "contacted", { gateReportId: gates.report.id, gateReport: gates.report, campaignId: d.campaign.id }));

    let hero = leads.find((l) => l.listId === listA.id && inState(l, "contacted"))!;
    hero = step(hero, "replied", { replyId: "r1" });
    hero = step(hero, "positive", { replyClass: "positive" });
    hero = step(hero, "booked", { meetingAt: "2026-12-01T09:00" });
    hero = step(hero, "closed_won", { dealId: "d1", dealValue: 24000 });
    replace(hero);

    const lal = buildLookalikeList(hero, d, d.lists, budget);
    if (!lal.ok) throw new Error(lal.reason);
    expect(lal.list.parentListId).toBe("list-a");
    const lists = [...d.lists, lal.list];
    leads = [...leads, ...lal.leads];
    expect(lal.leads.every((l) => inState(l, "list_built"))).toBe(true);

    const report = revenueReport(leads, lists, budget.ledger());
    const rowA = report.byList.find((r) => r.key === "list-a")!;
    expect(rowA.wonRevenue).toBe(24000);
    expect(rowA.cost).toBeGreaterThan(0);
    expect(rowA.booked).toBe(1);
    const rowLal = report.byList.find((r) => r.key === lal.list.id)!;
    expect(rowLal.leads).toBe(lal.leads.length);
    expect(budget.spentCents()).toBeLessThanOrEqual(budget.capCents());
  });

  it("keeps list B from starting", () => {
    const d = demoData();
    const listB = d.lists[1]!;
    const r = runGates({ id: "rep-2", campaign: { ...d.campaign, listId: listB.id }, list: listB, companies: d.companies, contacts: d.contacts, leads: d.leads, scores: {}, targetRoles: d.targetRoles }, createBudget());
    if (!r.ok) throw new Error(r.reason);
    expect(canStart(r.report).ok).toBe(false);
    const lead = step(d.leads.find((l) => l.listId === listB.id)!, "verified", { emailCheck: "valid" });
    expect(applyTransition(lead, "contacted", { gateReportId: r.report.id, gateReport: r.report, campaignId: "camp-1" }, AT).ok).toBe(false);
  });
});
