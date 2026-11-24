// Speicher im Browser (localStorage). Kein Server, kein Login: alle Daten
// sind Demo-Daten und bleiben auf diesem Gerät. Der Speicher wird übergeben,
// damit Tests ohne Browser laufen.

import { createBudget } from "./budget.js";
import { demoData } from "./demo.js";

export const STORE_KEY = "revenue-loop:v1";

/**
 * @typedef {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void }} KeyValue
 * @typedef {import("./demo.js").Demo & {
 *   version: 1,
 *   scores: Record<string, import("./score.js").Score>,
 *   reports: import("./gates.js").GateReport[],
 *   budget: import("./budget.js").BudgetSnapshot,
 *   nextReportNo: number,
 *   log: string[],
 * }} Session
 */

/** @returns {Session} */
export function freshSession() {
  return { version: 1, ...demoData(), scores: {}, reports: [], budget: createBudget().snapshot(), nextReportNo: 1, log: [] };
}

/**
 * @param {KeyValue} storage
 * @returns {Session}
 */
export function load(storage) {
  try {
    const raw = storage.getItem(STORE_KEY);
    if (!raw) return freshSession();
    const data = JSON.parse(raw);
    // Alte oder kaputte Stände nicht halb laden, sondern neu beginnen.
    if (!data || data.version !== 1 || !Array.isArray(data.leads) || !data.budget) return freshSession();
    return /** @type {Session} */ (data);
  } catch {
    return freshSession();
  }
}

/**
 * @param {KeyValue} storage
 * @param {Session} session
 */
export function save(storage, session) {
  storage.setItem(STORE_KEY, JSON.stringify(session));
}

/**
 * @param {KeyValue} storage
 * @returns {Session}
 */
export function reset(storage) {
  storage.removeItem(STORE_KEY);
  return freshSession();
}
