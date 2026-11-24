import { applyTransition, type Lead } from "../public/lib/transitions.js";

export const AT = "2026-11-24T10:00:00Z";
export const PASSED = { id: "rep-1", pass: true };

export function step(lead: Lead, to: string, evidence: Record<string, unknown>): Lead {
  const r = applyTransition(lead, to, evidence, AT);
  if (!r.ok) throw new Error(r.reason);
  return r.lead;
}

// Führt einen Lead über die Tabelle bis zum gewünschten Zustand.
export function walk(lead: Lead, path: string[], dealValue = 10000): Lead {
  const evidence: Record<string, Record<string, unknown>> = {
    verified: { emailCheck: "valid" },
    contacted: { gateReportId: PASSED.id, gateReport: PASSED, campaignId: "camp-1" },
    replied: { replyId: "r1" },
    bounced: { bounceCode: "550" },
    positive: { replyClass: "positive" },
    not_interested: { replyId: "r2" },
    booked: { meetingAt: "2026-12-01T09:00" },
    closed_won: { dealId: "d1", dealValue },
    closed_lost: { lostReason: "budget frozen" },
  };
  return path.reduce((l, to) => step(l, to, evidence[to] ?? {}), lead);
}

export const TO_WON = ["verified", "contacted", "replied", "positive", "booked", "closed_won"];
