// Simuliertes Kostenbudget pro Sitzung. Jede simulierte Abfrage bucht hier
// über charge(). Beträge laufen intern als ganze Cent, damit sich keine
// Rundungsfehler aufsummieren. Es fließt kein echtes Geld: keine bezahlte API,
// kein Versand. Die Sätze sind ausgedacht und als „simulated“ gekennzeichnet.

/** Simulierte Kostensätze in Cent. simulated, not a vendor price. */
export const COSTS = Object.freeze({
  company_lookup: 3,
  email_check: 1,
  contact_lookup: 10,
  ai_judgment: 0,
});

export const COST_NOTE = "simulated, not a vendor price";
export const DEFAULT_CAP_EUR = 5;
export const HARD_CAP_EUR = 20;
// Riegel „Kein Geld“: höchstens so viele AI-Urteile pro Sitzung, egal wie viel Budget übrig ist.
export const MAX_AI_CALLS = 30;

/**
 * @typedef {keyof typeof COSTS} CostKind
 * @typedef {{ seq: number, kind: CostKind, listId: string, cents: number }} LedgerEntry
 * @typedef {{ capCents: number, ledger: LedgerEntry[], aiCalls: number }} BudgetSnapshot
 * @typedef {{ ok: false, reason: "budget", needed: number, remaining: number }} BudgetRefusal
 * @typedef {{ ok: false, reason: "ai-limit", limit: number }} AiLimitRefusal
 * @typedef {{
 *   capCents: () => number,
 *   spentCents: () => number,
 *   remainingCents: () => number,
 *   aiCalls: () => number,
 *   ledger: () => LedgerEntry[],
 *   afford: (items: { kind: CostKind, count: number }[]) => { ok: true } | BudgetRefusal | AiLimitRefusal,
 *   charge: (kind: CostKind, listId: string) => { ok: true, entry: LedgerEntry } | BudgetRefusal | AiLimitRefusal,
 *   raiseCap: (newCapEur: number) => { ok: true } | { ok: false, reason: string },
 *   setCap: (capEur: number) => { ok: true } | { ok: false, reason: string },
 *   proposeCap: (neededCents: number) => number | null,
 *   snapshot: () => BudgetSnapshot,
 * }} Budget
 */

/** @param {number} eur */
export const toCents = (eur) => Math.round(eur * 100);
/** @param {number} cents */
export const toEur = (cents) => cents / 100;

/**
 * @param {number} [capEur]
 * @param {BudgetSnapshot} [saved]
 * @returns {Budget}
 */
export function createBudget(capEur = DEFAULT_CAP_EUR, saved) {
  let cap = saved ? saved.capCents : toCents(capEur);
  /** @type {LedgerEntry[]} */
  const ledger = saved ? saved.ledger.map((e) => ({ ...e })) : [];
  let aiCalls = saved ? saved.aiCalls : 0;
  let spent = ledger.reduce((sum, e) => sum + e.cents, 0);

  const remaining = () => Math.max(0, cap - spent);

  /** @param {number} needed */
  const refuse = (needed) => /** @type {BudgetRefusal} */ ({ ok: false, reason: "budget", needed: toEur(needed), remaining: toEur(remaining()) });

  /** @type {Budget["afford"]} */
  const afford = (items) => {
    const ai = items.filter((i) => i.kind === "ai_judgment").reduce((n, i) => n + i.count, 0);
    if (aiCalls + ai > MAX_AI_CALLS) return { ok: false, reason: "ai-limit", limit: MAX_AI_CALLS };
    const needed = items.reduce((sum, i) => sum + COSTS[i.kind] * i.count, 0);
    return spent + needed > cap ? refuse(needed) : { ok: true };
  };

  /** @param {number} capEurNew */
  const validCap = (capEurNew) => {
    if (!Number.isFinite(capEurNew) || capEurNew < 0) return "limit must be a number of 0 or more";
    if (capEurNew > HARD_CAP_EUR) return `limit cannot go above the hard cap of €${HARD_CAP_EUR}`;
    return "";
  };

  return {
    capCents: () => cap,
    spentCents: () => spent,
    remainingCents: remaining,
    aiCalls: () => aiCalls,
    ledger: () => ledger.map((e) => ({ ...e })),
    afford,
    charge(kind, listId) {
      const check = afford([{ kind, count: 1 }]);
      if (!check.ok) return check;
      const entry = { seq: ledger.length + 1, kind, listId, cents: COSTS[kind] };
      ledger.push(entry);
      spent += entry.cents;
      if (kind === "ai_judgment") aiCalls += 1;
      return { ok: true, entry: { ...entry } };
    },
    raiseCap(newCapEur) {
      const problem = validCap(newCapEur);
      if (problem) return { ok: false, reason: problem };
      if (toCents(newCapEur) <= cap) return { ok: false, reason: "new limit must be above the current one" };
      cap = toCents(newCapEur);
      return { ok: true };
    },
    setCap(capEurNew) {
      const problem = validCap(capEurNew);
      if (problem) return { ok: false, reason: problem };
      cap = toCents(capEurNew);
      return { ok: true };
    },
    // Vorschlag für die Rückfrage: auf den nächsten vollen Euro über dem Bedarf.
    proposeCap(neededCents) {
      const next = Math.ceil((spent + neededCents) / 100);
      return next <= HARD_CAP_EUR ? next : null;
    },
    snapshot: () => ({ capCents: cap, ledger: ledger.map((e) => ({ ...e })), aiCalls }),
  };
}
