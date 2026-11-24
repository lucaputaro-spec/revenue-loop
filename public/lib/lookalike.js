// Closed Loop: jeder gewonnene Lead wird zur Saat einer neuen Liste. Gesucht
// werden Firmen, die der gewonnenen Firma ähneln und noch in keiner Liste
// stehen. Die neue Liste merkt sich ihre Elternliste, damit der Umsatz später
// bis zur Ursprungsliste zurückverfolgt werden kann.

import { createLead, inState } from "./transitions.js";
import { similarity } from "./score.js";

/**
 * @typedef {import("./demo.js").Company} Company
 * @typedef {import("./demo.js").Contact} Contact
 * @typedef {import("./demo.js").List} List
 * @typedef {import("./transitions.js").Lead} Lead
 * @typedef {import("./budget.js").Budget} Budget
 * @typedef {import("./budget.js").BudgetRefusal} BudgetRefusal
 * @typedef {import("./budget.js").AiLimitRefusal} AiLimitRefusal
 */

export const MIN_SIMILARITY = 0.6;
export const MAX_LOOKALIKES = 10;

/**
 * @param {Lead} wonLead
 * @param {{ companies: Company[], contacts: Contact[] }} universe
 * @param {List[]} existingLists
 * @param {Budget} budget
 * @returns {{ ok: true, list: List, leads: Lead[], similarity: Record<string, number> }
 *   | BudgetRefusal | AiLimitRefusal | { ok: false, reason: "not-won" | "seed-missing" | "no-match" }}
 */
export function buildLookalikeList(wonLead, universe, existingLists, budget) {
  if (!inState(wonLead, "closed_won")) return { ok: false, reason: "not-won" };
  const seed = universe.companies.find((c) => c.id === wonLead.companyId);
  if (!seed) return { ok: false, reason: "seed-missing" };

  const used = new Set(existingLists.flatMap((l) => l.companyIds));
  used.add(seed.id);
  const picked = universe.companies
    .filter((c) => !used.has(c.id))
    .map((c) => ({ c, s: similarity(seed, c) }))
    .filter((x) => x.s >= MIN_SIMILARITY)
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id))
    .slice(0, MAX_LOOKALIKES);
  if (!picked.length) return { ok: false, reason: "no-match" };

  // Budget für alle Firmen-Abfragen vorab prüfen: eine Absage bucht nichts.
  const check = budget.afford([{ kind: "company_lookup", count: picked.length }]);
  if (!check.ok) return check;

  const listId = `lal-${seed.id}`;
  for (let i = 0; i < picked.length; i++) budget.charge("company_lookup", listId);

  /** @type {List} */
  const list = {
    id: listId,
    name: `Lookalikes of ${seed.name} (from ${wonLead.listId})`,
    segment: wonLead.segment,
    parentListId: wonLead.listId,
    seedCompanyId: seed.id,
    companyIds: picked.map((x) => x.c.id),
  };
  const leads = picked.map(({ c }) =>
    createLead({ listId, segment: list.segment, companyId: c.id, contactId: universe.contacts.find((p) => p.companyId === c.id)?.id ?? "" }),
  );
  return { ok: true, list, leads, similarity: Object.fromEntries(picked.map((x) => [x.c.id, x.s])) };
}

/**
 * Gewonnene Leads, deren Lookalike-Liste noch fehlt (z. B. weil das Budget
 * nicht erhöht wurde). Der Zustand kommt nur aus den Daten, deshalb gilt das
 * auch für ältere gespeicherte Stände.
 * @param {Lead[]} leads
 * @param {List[]} lists
 * @returns {Lead[]}
 */
export function missingLookalikes(leads, lists) {
  const seeded = new Set(lists.map((l) => l.seedCompanyId).filter((id) => id !== null));
  return leads.filter((l) => inState(l, "closed_won") && !seeded.has(l.companyId));
}
