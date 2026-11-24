import { describe, expect, it } from "vitest";
import { applyTransition, createLead, inState, STATES, TERMINAL_STATES, TRANSITIONS, type Lead } from "../public/lib/transitions.js";

const AT = "2026-11-24T10:00:00Z";
const fresh = () => createLead({ listId: "list-a", segment: "SaaS DACH 50–200", companyId: "c1", contactId: "p1" });
const passed = { id: "rep-1", pass: true, listId: "list-a", campaignId: "camp-1" };

function step(lead: Lead, to: string, evidence: Record<string, unknown>): Lead {
  const r = applyTransition(lead, to, evidence, AT);
  if (!r.ok) throw new Error(r.reason);
  return r.lead;
}

function toBooked(): Lead {
  let l = step(fresh(), "verified", { emailCheck: "valid" });
  l = step(l, "contacted", { gateReportId: "rep-1", gateReport: passed, campaignId: "camp-1" });
  l = step(l, "replied", { replyId: "r1" });
  l = step(l, "positive", { replyClass: "positive" });
  return step(l, "booked", { meetingAt: "2026-12-01T09:00" });
}

describe("transition table", () => {
  it("starts new leads at list_built", () => {
    expect(inState(fresh(), "list_built")).toBe(true);
  });

  it("rejects a jump that is not in the table and keeps the state", () => {
    const lead = fresh();
    const r = applyTransition(lead, "booked", { meetingAt: "x" }, AT);
    expect(r).toEqual({ ok: false, reason: "not in transition table: list_built → booked" });
    expect(inState(lead, "list_built")).toBe(true);
  });

  it("rejects closed_won without a deal value", () => {
    const r = applyTransition(toBooked(), "closed_won", { dealId: "d1" }, AT);
    expect(r).toEqual({ ok: false, reason: "missing evidence: dealValue" });
    const zero = applyTransition(toBooked(), "closed_won", { dealId: "d1", dealValue: 0 }, AT);
    expect(zero.ok).toBe(false);
  });

  it("rejects contact when the gate report did not pass, even with an id", () => {
    const verified = step(fresh(), "verified", { emailCheck: "valid" });
    const r = applyTransition(verified, "contacted", { gateReportId: "rep-2", gateReport: { id: "rep-2", pass: false, listId: "list-a", campaignId: "camp-1" }, campaignId: "camp-1" }, AT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("gate report did not pass");
    const noReport = applyTransition(verified, "contacted", { gateReportId: "rep-2", campaignId: "camp-1" }, AT);
    expect(noReport.ok).toBe(false);
  });

  it("rejects a passed report from another list", () => {
    const verified = step(fresh(), "verified", { emailCheck: "valid" });
    const r = applyTransition(verified, "contacted", { gateReportId: "rep-1", gateReport: { ...passed, listId: "list-b" }, campaignId: "camp-1" }, AT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("gate report is for list-b, lead is on list-a");
    expect(inState(verified, "verified")).toBe(true);
  });

  it("rejects a passed report from another campaign", () => {
    const verified = step(fresh(), "verified", { emailCheck: "valid" });
    const r = applyTransition(verified, "contacted", { gateReportId: "rep-1", gateReport: passed, campaignId: "camp-2" }, AT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("gate report is for another campaign");
  });

  it("has no exits from end states", () => {
    expect(TERMINAL_STATES.sort()).toEqual(["bounced", "closed_lost", "closed_won", "not_interested", "unsubscribed"]);
    for (const end of TERMINAL_STATES) {
      expect(TRANSITIONS.filter((t) => t.from === end)).toEqual([]);
      const lead = { ...fresh(), state: end };
      for (const to of STATES) expect(applyTransition(lead, to, {}, AT).ok).toBe(false);
    }
  });

  it("keeps listId and segment frozen along the whole path", () => {
    const won = step(toBooked(), "closed_won", { dealId: "d1", dealValue: 12000, listId: "list-x", segment: "other" });
    expect(won.listId).toBe("list-a");
    expect(won.segment).toBe("SaaS DACH 50–200");
    expect(inState(won, "closed_won")).toBe(true);
    expect(won.history.map((h) => h.to)).toEqual(["verified", "contacted", "replied", "positive", "booked", "closed_won"]);
    expect(won.history.at(-1)?.evidence).toEqual({ dealId: "d1", dealValue: 12000 });
  });

  it("asks for at least one piece of evidence in every row", () => {
    for (const t of TRANSITIONS) expect(Object.keys(t.evidence).length).toBeGreaterThanOrEqual(1);
  });
});
