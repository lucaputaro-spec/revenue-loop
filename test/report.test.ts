import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../public/lib/budget.js";
import type { List } from "../public/lib/demo.js";
import { revenueReport } from "../public/lib/report.js";
import { createLead } from "../public/lib/transitions.js";
import { TO_WON, walk } from "./helpers";

const list = (id: string, segment: string): List => ({ id, name: id.toUpperCase(), segment, parentListId: null, seedCompanyId: null, companyIds: [] });
const lead = (listId: string, segment: string, n: number) => createLead({ listId, segment, companyId: `c${n}`, contactId: `p${n}` });
const entries = (listId: string, kind: LedgerEntry["kind"], cents: number, count: number): LedgerEntry[] =>
  Array.from({ length: count }, (_, i) => ({ seq: i, kind, listId, cents }));

describe("revenue report", () => {
  it("matches a hand-calculated case with two lists and two segments", () => {
    const lists = [list("l1", "S1"), list("l2", "S2")];
    const leads = [
      walk(lead("l1", "S1", 1), TO_WON, 10000),
      walk(lead("l1", "S1", 2), ["verified", "contacted", "replied", "positive", "booked", "closed_lost"]),
      walk(lead("l1", "S1", 3), ["verified", "contacted", "replied", "positive", "booked"]),
      walk(lead("l1", "S1", 4), ["verified", "contacted"]),
      lead("l1", "S1", 5),
      walk(lead("l2", "S2", 6), ["verified", "contacted", "replied"]),
      walk(lead("l2", "S2", 7), ["verified", "contacted", "bounced"]),
    ];
    const ledger = [
      ...entries("l1", "company_lookup", 3, 12), // 0,36 €
      ...entries("l1", "contact_lookup", 10, 10), // 1,00 €
      ...entries("l1", "email_check", 1, 4), // 0,04 €
      ...entries("l2", "company_lookup", 3, 3), // 0,09 €
      ...entries("", "email_check", 1, 2), // ohne Liste
    ];
    const r = revenueReport(leads, lists, ledger);

    const l1 = r.byList[0]!;
    expect(l1).toMatchObject({ key: "l1", leads: 5, booked: 3, won: 1, wonRevenue: 10000, cost: 1.4, costPerMeeting: 0.47, revenuePerEuro: 7142.86, replyRate: 0.75 });
    expect(l1.states).toMatchObject({ list_built: 1, contacted: 1, booked: 1, closed_won: 1, closed_lost: 1, replied: 0 });

    const l2 = r.byList[1]!;
    expect(l2).toMatchObject({ key: "l2", leads: 2, booked: 0, won: 0, wonRevenue: 0, cost: 0.09, costPerMeeting: null, revenuePerEuro: 0, replyRate: 0.5 });
    expect(l2.states).toMatchObject({ replied: 1, bounced: 1 });

    expect(r.bySegment.map((s) => [s.key, s.wonRevenue, s.cost, s.booked])).toEqual([
      ["S1", 10000, 1.4, 3],
      ["S2", 0, 0.09, 0],
    ]);
    expect(r.unassignedCost).toBe(0.02);
  });
});
