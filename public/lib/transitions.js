// Die Übergangstabelle. Sie ist die einzige Quelle dafür, welcher Zustand auf
// welchen folgen darf und welcher Nachweis dafür nötig ist. Nur
// applyTransition() setzt den Zustand eines Leads. Was nicht in der Tabelle
// steht, wird abgewiesen, auch wenn die Seite umgangen wird.

export const STATES = /** @type {const} */ ([
  "list_built",
  "verified",
  "contacted",
  "replied",
  "bounced",
  "unsubscribed",
  "positive",
  "not_interested",
  "booked",
  "closed_won",
  "closed_lost",
]);

/** @typedef {typeof STATES[number]} State */

/**
 * @typedef {{ id: string, pass: boolean, listId: string, campaignId: string }} GateReportRef
 * @typedef {Record<string, unknown> & { gateReport?: GateReportRef }} Evidence
 * @typedef {(value: unknown, evidence: Evidence, lead: Lead) => string | null} Validator
 * @typedef {{ from: State, to: State, trigger: string, evidence: Record<string, Validator> }} Transition
 * @typedef {{ from: State, to: State, at: string, evidence: Record<string, unknown> }} HistoryEntry
 * @typedef {{
 *   id: string, listId: string, segment: string, companyId: string, contactId: string,
 *   state: State, history: HistoryEntry[]
 * }} Lead
 */

/** @type {Validator} */
const text = (v) => (typeof v === "string" && v.trim() ? null : "must be text");

/** @type {Validator} */
const passedGate = (v, ev, lead) => {
  const report = ev.gateReport;
  if (!report || report.id !== v) return "gate report not found";
  // Ein bestandener Bericht gilt nur für die Liste und Kampagne, die er geprüft hat.
  if (report.listId !== lead.listId) return `gate report is for ${report.listId}, lead is on ${lead.listId}`;
  if (report.campaignId !== ev.campaignId) return "gate report is for another campaign";
  return report.pass === true ? null : "gate report did not pass";
};

/**
 * Baut eine Zeile je Ausgangszustand, damit jede Zeile genau ein `from` hat.
 * @param {State[]} froms
 * @param {State} to
 * @param {string} trigger
 * @param {Record<string, Validator>} evidence
 * @returns {Transition[]}
 */
const rows = (froms, to, trigger, evidence) => froms.map((from) => ({ from, to, trigger, evidence }));

/** @type {readonly Transition[]} */
export const TRANSITIONS = Object.freeze([
  ...rows(["list_built"], "verified", "email check", { emailCheck: (v) => (v === "valid" ? null : 'must be "valid"') }),
  ...rows(["verified"], "contacted", "campaign started after gates", { gateReportId: passedGate, campaignId: text }),
  ...rows(["contacted"], "replied", "reply received", { replyId: text }),
  ...rows(["contacted"], "bounced", "email bounced", { bounceCode: text }),
  ...rows(["contacted", "replied"], "unsubscribed", "unsubscribe request", { unsubscribeAt: text }),
  ...rows(["replied"], "positive", "reply classified", { replyClass: (v) => (v === "positive" ? null : 'must be "positive"') }),
  ...rows(["replied", "positive"], "not_interested", "said no", { replyId: text }),
  ...rows(["positive"], "booked", "meeting booked", { meetingAt: text }),
  ...rows(["booked"], "closed_won", "deal won", {
    dealId: text,
    dealValue: (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? null : "must be a number above 0"),
  }),
  ...rows(["booked"], "closed_lost", "deal lost", { lostReason: text }),
]);

/** @type {State[]} */
export const TERMINAL_STATES = STATES.filter((s) => !TRANSITIONS.some((t) => t.from === s));

/**
 * Lesender Zugriff für alle anderen Module, damit niemand außer dieser Datei
 * mit dem Feld `state` hantiert.
 * @param {{ state: State }} lead
 * @param {...State} states
 * @returns {boolean}
 */
export function inState(lead, ...states) {
  return states.includes(lead.state);
}

/**
 * @param {State} from
 * @param {State} to
 * @returns {Transition | undefined}
 */
export function findTransition(from, to) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/**
 * @param {{ listId: string, segment: string, companyId: string, contactId: string, id?: string }} p
 * @returns {Lead}
 */
export function createLead({ listId, segment, companyId, contactId, id }) {
  return { id: id ?? `${listId}:${companyId}`, listId, segment, companyId, contactId, state: "list_built", history: [] };
}

/**
 * @param {Lead} lead
 * @param {string} to
 * @param {Evidence} evidence
 * @param {string} at
 * @returns {{ ok: true, lead: Lead } | { ok: false, reason: string }}
 */
export function applyTransition(lead, to, evidence, at) {
  const target = STATES.find((s) => s === to);
  if (!target) return { ok: false, reason: `unknown state: ${to}` };
  const row = findTransition(lead.state, target);
  if (!row) return { ok: false, reason: `not in transition table: ${lead.state} → ${to}` };

  /** @type {Record<string, unknown>} */
  const kept = {};
  for (const [key, check] of Object.entries(row.evidence)) {
    const value = evidence[key];
    if (value === undefined || value === null || value === "") return { ok: false, reason: `missing evidence: ${key}` };
    const problem = check(value, evidence, lead);
    if (problem) return { ok: false, reason: `invalid evidence: ${key} (${problem})` };
    kept[key] = value;
  }

  // Nur die Nachweise aus der Tabellenzeile wandern in die Historie. listId
  // und segment werden nie aus dem Nachweis übernommen und bleiben eingefroren.
  /** @type {Lead} */
  const next = { ...lead, history: [...lead.history, { from: lead.state, to: target, at, evidence: kept }] };
  next.state = target;
  return { ok: true, lead: next };
}
