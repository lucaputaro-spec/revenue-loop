// Umsatz pro Liste und Segment. Hauptzahlen sind Termine, Umsatz und Kosten,
// nicht die Antwortquote: eine Liste mit vielen Antworten und null Umsatz ist
// keine gute Liste. Kosten kommen aus dem Ledger, zugeordnet über die listId.

import { STATES } from "./transitions.js";

/**
 * @typedef {import("./transitions.js").Lead} Lead
 * @typedef {import("./transitions.js").State} State
 * @typedef {import("./demo.js").List} List
 * @typedef {import("./budget.js").LedgerEntry} LedgerEntry
 * @typedef {{
 *   key: string, label: string, leads: number, states: Record<State, number>, booked: number, won: number,
 *   wonRevenue: number, cost: number, costPerMeeting: number | null, revenuePerEuro: number | null, replyRate: number | null
 * }} ReportRow
 */

/** @param {Lead} lead */
const reached = (lead, /** @type {State} */ s) => lead.history.some((h) => h.to === s);

/** @param {Lead} lead */
function dealValue(lead) {
  const win = lead.history.find((h) => h.to === "closed_won");
  const v = win?.evidence.dealValue;
  return typeof v === "number" ? v : 0;
}

/**
 * @param {string} key
 * @param {string} label
 * @param {Lead[]} leads
 * @param {number} costCents
 * @returns {ReportRow}
 */
function row(key, label, leads, costCents) {
  const states = /** @type {Record<State, number>} */ (Object.fromEntries(STATES.map((s) => [s, 0])));
  for (const l of leads) states[l.state] += 1;
  const booked = states.booked + states.closed_won + states.closed_lost;
  const wonRevenue = leads.reduce((sum, l) => sum + dealValue(l), 0);
  const contacted = leads.filter((l) => reached(l, "contacted")).length;
  const replied = leads.filter((l) => reached(l, "replied")).length;
  return {
    key,
    label,
    leads: leads.length,
    states,
    booked,
    won: states.closed_won,
    wonRevenue,
    cost: costCents / 100,
    costPerMeeting: booked ? Math.round(costCents / booked) / 100 : null,
    revenuePerEuro: costCents ? Math.round((wonRevenue / (costCents / 100)) * 100) / 100 : null,
    replyRate: contacted ? replied / contacted : null,
  };
}

/**
 * @param {Lead[]} leads
 * @param {List[]} lists
 * @param {LedgerEntry[]} ledger
 * @returns {{ byList: ReportRow[], bySegment: ReportRow[], unassignedCost: number }}
 */
export function revenueReport(leads, lists, ledger) {
  /** @type {Map<string, number>} */
  const centsByList = new Map();
  for (const e of ledger) centsByList.set(e.listId, (centsByList.get(e.listId) ?? 0) + e.cents);
  const known = new Set(lists.map((l) => l.id));
  const unassigned = ledger.filter((e) => !known.has(e.listId)).reduce((s, e) => s + e.cents, 0);

  const byList = lists.map((l) => row(l.id, l.name, leads.filter((x) => x.listId === l.id), centsByList.get(l.id) ?? 0));

  const segments = [...new Set(lists.map((l) => l.segment))];
  const bySegment = segments.map((seg) => {
    const ids = new Set(lists.filter((l) => l.segment === seg).map((l) => l.id));
    const cents = [...ids].reduce((s, id) => s + (centsByList.get(id) ?? 0), 0);
    return row(seg, seg, leads.filter((x) => ids.has(x.listId)), cents);
  });

  return { byList, bySegment, unassignedCost: unassigned / 100 };
}
