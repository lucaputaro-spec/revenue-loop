import { describe, expect, it } from "vitest";
import { COSTS, createBudget, HARD_CAP_EUR, MAX_AI_CALLS } from "../public/lib/budget.js";

describe("budget", () => {
  it("keeps a running total in whole cents that matches the ledger", () => {
    const b = createBudget(5);
    for (let i = 0; i < 7; i++) b.charge("company_lookup", "list-a");
    b.charge("email_check", "list-a");
    b.charge("contact_lookup", "list-b");
    expect(b.spentCents()).toBe(7 * COSTS.company_lookup + COSTS.email_check + COSTS.contact_lookup);
    expect(b.spentCents()).toBe(32);
    expect(b.ledger().reduce((s, e) => s + e.cents, 0)).toBe(b.spentCents());
    expect(b.remainingCents()).toBe(500 - 32);
  });

  it("refuses a charge over the limit and books nothing", () => {
    const b = createBudget(0.1);
    for (let i = 0; i < 3; i++) expect(b.charge("company_lookup", "list-a").ok).toBe(true);
    const before = b.ledger();
    const r = b.charge("company_lookup", "list-a");
    expect(r).toEqual({ ok: false, reason: "budget", needed: 0.03, remaining: 0.01 });
    expect(b.ledger()).toEqual(before);
    expect(b.spentCents()).toBe(9);
  });

  it("checks a whole batch before anything is booked", () => {
    const b = createBudget(0.1);
    expect(b.afford([{ kind: "company_lookup", count: 12 }])).toEqual({ ok: false, reason: "budget", needed: 0.36, remaining: 0.1 });
    expect(b.ledger()).toEqual([]);
  });

  it("refuses to raise the limit above the hard cap", () => {
    const b = createBudget(5);
    expect(HARD_CAP_EUR).toBe(20);
    expect(b.raiseCap(25).ok).toBe(false);
    expect(b.capCents()).toBe(500);
    expect(b.raiseCap(4).ok).toBe(false);
    expect(b.raiseCap(20)).toEqual({ ok: true });
    expect(b.capCents()).toBe(2000);
    expect(b.setCap(21).ok).toBe(false);
  });

  it("proposes the next full euro above the need, never above the hard cap", () => {
    const b = createBudget(0.1);
    expect(b.proposeCap(36)).toBe(1);
    expect(b.proposeCap(2500)).toBeNull();
  });

  it("stops AI calls at the session limit even with money left", () => {
    const b = createBudget(5);
    for (let i = 0; i < MAX_AI_CALLS; i++) expect(b.charge("ai_judgment", "list-a").ok).toBe(true);
    expect(b.charge("ai_judgment", "list-a")).toEqual({ ok: false, reason: "ai-limit", limit: MAX_AI_CALLS });
  });

  it("restores from a snapshot", () => {
    const b = createBudget(3);
    b.charge("contact_lookup", "list-a");
    const again = createBudget(undefined, JSON.parse(JSON.stringify(b.snapshot())));
    expect(again.spentCents()).toBe(10);
    expect(again.capCents()).toBe(300);
  });
});
