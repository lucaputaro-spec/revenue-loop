// Drei Prüftore vor jeder Kampagne: Liste, Personen, Kampagne. Jedes Tor
// nennt Wert, Schwelle und jede einzelne Abweichung. Eine Kampagne startet nur
// mit einem Bericht, in dem alle drei bestanden sind. Der Übergang
// verified → contacted verlangt denselben Bericht als Nachweis.

import { seededRandom } from "./demo.js";
import { brokenRule, MUST_RULES } from "./score.js";

/**
 * @typedef {import("./demo.js").Company} Company
 * @typedef {import("./demo.js").Contact} Contact
 * @typedef {import("./demo.js").List} List
 * @typedef {import("./demo.js").Campaign} Campaign
 * @typedef {import("./transitions.js").Lead} Lead
 * @typedef {import("./score.js").Score} Score
 * @typedef {import("./score.js").MustRule} MustRule
 * @typedef {import("./budget.js").Budget} Budget
 * @typedef {import("./budget.js").BudgetRefusal} BudgetRefusal
 * @typedef {import("./budget.js").AiLimitRefusal} AiLimitRefusal
 * @typedef {{ id: string, reason: string }} Failure
 * @typedef {{ gate: "list" | "person" | "campaign", pass: boolean, value: number, threshold: number, failures: Failure[], summary: string }} GateResult
 * @typedef {{ id: string, companyId: string, vars: Record<string, string> }} CampaignLead
 * @typedef {{ id: string, campaignId: string, listId: string, pass: boolean, gates: GateResult[] }} GateReport
 */

// Schwellen in Prozent, verglichen mit ganzen Zahlen, damit 7/10 sicher 70 % ist.
export const LIST_GATE_PCT = 70;
export const PERSON_GATE_PCT = 80;
export const CAMPAIGN_GATE_PCT = 100;
export const PERSON_SAMPLE = 10;
export const PERSON_SEED = 42;

/**
 * @param {number} part
 * @param {number} whole
 * @param {number} pct
 */
const reaches = (part, whole, pct) => whole > 0 && part * 100 >= pct * whole;
/** @param {number} v */
const asPct = (v) => Math.round(v * 100);

/**
 * Listen-Tor: Anteil gültiger Websites und keine verletzte Muss-Regel.
 * Bucht je Firma eine simulierte Firmen-Abfrage.
 * @param {List} list
 * @param {Company[]} companies
 * @param {MustRule[]} rules
 * @param {Budget} budget
 * @returns {GateResult | BudgetRefusal | AiLimitRefusal}
 */
export function listGate(list, companies, rules, budget) {
  const check = budget.afford([{ kind: "company_lookup", count: list.companyIds.length }]);
  if (!check.ok) return check;
  /** @type {Failure[]} */
  const failures = [];
  let valid = 0;
  let broken = 0;
  for (const id of list.companyIds) {
    budget.charge("company_lookup", list.id);
    const c = companies.find((x) => x.id === id);
    if (!c) {
      failures.push({ id, reason: "company not found" });
      continue;
    }
    if (c.websiteStatus === "valid") valid += 1;
    else failures.push({ id, reason: `website ${c.domain} is not valid` });
    const b = brokenRule(c, rules);
    if (b) {
      broken += 1;
      failures.push({ id, reason: `breaks must rule ${b.rule.id}: ${b.reason}` });
    }
  }
  const n = list.companyIds.length;
  const value = n ? valid / n : 0;
  const pass = reaches(valid, n, LIST_GATE_PCT) && broken === 0;
  let summary = `list gate: ${asPct(value)}% valid, needs ${LIST_GATE_PCT}%`;
  if (broken) summary += `; ${broken} ${broken === 1 ? "company breaks" : "companies break"} a must rule`;
  return { gate: "list", pass, value, threshold: LIST_GATE_PCT / 100, failures, summary };
}

/**
 * Feste Stichprobe: gleiche Kontakte und gleicher Startwert ergeben immer dieselbe Auswahl.
 * @param {Contact[]} contacts
 * @param {number} seed
 * @param {number} size
 * @returns {Contact[]}
 */
export function sample(contacts, seed, size) {
  const pool = [...contacts].sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length <= size) return pool;
  const rnd = seededRandom(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = /** @type {Contact} */ (pool[i]);
    pool[i] = /** @type {Contact} */ (pool[j]);
    pool[j] = tmp;
  }
  return pool.slice(0, size);
}

/**
 * Personen-Tor: Stichprobe von 10 Ansprechpartnern, Anteil mit Titel aus den Zielrollen.
 * Bucht je gezogener Person eine simulierte Ansprechpartner-Abfrage.
 * @param {Contact[]} contacts
 * @param {string[]} targetRoles
 * @param {number} seed
 * @param {Budget} budget
 * @param {string} [listId]
 * @returns {GateResult | BudgetRefusal | AiLimitRefusal}
 */
export function personGate(contacts, targetRoles, seed, budget, listId = "") {
  const picked = sample(contacts, seed, PERSON_SAMPLE);
  const check = budget.afford([{ kind: "contact_lookup", count: picked.length }]);
  if (!check.ok) return check;
  const roles = targetRoles.map((r) => r.toLowerCase());
  /** @type {Failure[]} */
  const failures = [];
  let hits = 0;
  for (const p of picked) {
    budget.charge("contact_lookup", listId);
    const title = p.title.toLowerCase();
    if (roles.some((r) => title.includes(r))) hits += 1;
    else failures.push({ id: p.id, reason: `title "${p.title}" is not a target role` });
  }
  const value = picked.length ? hits / picked.length : 0;
  return {
    gate: "person",
    pass: reaches(hits, picked.length, PERSON_GATE_PCT),
    value,
    threshold: PERSON_GATE_PCT / 100,
    failures,
    summary: `person gate: ${asPct(value)}% of ${picked.length} sampled contacts in target roles, needs ${PERSON_GATE_PCT}%`,
  };
}

/**
 * @param {Campaign} campaign
 * @returns {string[]}
 */
export function templateVars(campaign) {
  const names = new Set();
  for (const m of `${campaign.subject}\n${campaign.body}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) names.add(m[1]);
  return /** @type {string[]} */ ([...names]);
}

/**
 * Kampagnen-Tor: jede Variable bei jedem Lead gefüllt, jede Firma bewertet.
 * Keine Abfrage, daher keine Buchung.
 * @param {Campaign} campaign
 * @param {CampaignLead[]} leads
 * @param {Record<string, Score>} scores
 * @returns {GateResult}
 */
export function campaignGate(campaign, leads, scores) {
  const vars = templateVars(campaign);
  /** @type {Failure[]} */
  const failures = [];
  let ready = 0;
  for (const lead of leads) {
    const missing = vars.filter((v) => !(lead.vars[v] ?? "").trim());
    const unscored = !scores[lead.companyId];
    for (const v of missing) failures.push({ id: lead.id, reason: `missing variable ${v}` });
    if (unscored) failures.push({ id: lead.id, reason: "company not scored" });
    if (!missing.length && !unscored) ready += 1;
  }
  const value = leads.length ? ready / leads.length : 0;
  return {
    gate: "campaign",
    pass: reaches(ready, leads.length, CAMPAIGN_GATE_PCT),
    value,
    threshold: CAMPAIGN_GATE_PCT / 100,
    failures,
    summary: leads.length ? `campaign gate: ${asPct(value)}% of leads ready, needs ${CAMPAIGN_GATE_PCT}%` : "campaign gate: list has no leads",
  };
}

/**
 * Variablen für die Vorlage aus Firma und Ansprechpartner.
 * @param {Lead} lead
 * @param {Company[]} companies
 * @param {Contact[]} contacts
 * @returns {CampaignLead}
 */
export function campaignLead(lead, companies, contacts) {
  const c = companies.find((x) => x.id === lead.companyId);
  const p = contacts.find((x) => x.id === lead.contactId);
  return {
    id: lead.id,
    companyId: lead.companyId,
    vars: { firstName: p?.firstName ?? "", lastName: p?.lastName ?? "", title: p?.title ?? "", companyName: c?.name ?? "" },
  };
}

/**
 * Alle drei Tore für eine Kampagne auf einer Liste. Prüft das Budget vorab für
 * alle Abfragen zusammen, damit eine Absage nichts halb bucht.
 * @param {{
 *   id: string, campaign: Campaign, list: List, companies: Company[], contacts: Contact[], leads: Lead[],
 *   scores: Record<string, Score>, targetRoles: string[], rules?: MustRule[], seed?: number
 * }} input
 * @param {Budget} budget
 * @returns {{ ok: true, report: GateReport } | BudgetRefusal | AiLimitRefusal}
 */
export function runGates(input, budget) {
  const { id, campaign, list, companies, contacts, scores, targetRoles } = input;
  const leads = input.leads.filter((l) => l.listId === list.id);
  const people = leads.map((l) => contacts.find((p) => p.id === l.contactId)).filter((p) => p !== undefined);
  const sampleSize = Math.min(PERSON_SAMPLE, people.length);
  const check = budget.afford([
    { kind: "company_lookup", count: list.companyIds.length },
    { kind: "contact_lookup", count: sampleSize },
  ]);
  if (!check.ok) return check;

  const lg = listGate(list, companies, input.rules ?? MUST_RULES, budget);
  if (!("gate" in lg)) return lg;
  const pg = personGate(people, targetRoles, input.seed ?? PERSON_SEED, budget, list.id);
  if (!("gate" in pg)) return pg;
  const cg = campaignGate(campaign, leads.map((l) => campaignLead(l, companies, contacts)), scores);
  const gates = [lg, pg, cg];
  return { ok: true, report: { id, campaignId: campaign.id, listId: list.id, pass: gates.every((g) => g.pass), gates } };
}

/**
 * @param {GateReport | null | undefined} report
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function canStart(report) {
  if (!report) return { ok: false, reasons: ["run the gates first"] };
  const reasons = report.gates.filter((g) => !g.pass).map((g) => g.summary);
  if (!report.pass && !reasons.length) reasons.push("gate report did not pass");
  return { ok: reasons.length === 0, reasons };
}

/**
 * Simulierte E-Mail-Prüfung für Leads, die noch bei list_built stehen. Liefert
 * den Nachweis emailCheck für den Übergang list_built → verified.
 * @param {Lead[]} leads
 * @param {Contact[]} contacts
 * @param {Budget} budget
 * @returns {{ ok: true, results: { leadId: string, emailCheck: "valid" | "invalid" }[] } | BudgetRefusal | AiLimitRefusal}
 */
export function checkEmails(leads, contacts, budget) {
  const check = budget.afford([{ kind: "email_check", count: leads.length }]);
  if (!check.ok) return check;
  const results = leads.map((l) => {
    budget.charge("email_check", l.listId);
    const p = contacts.find((x) => x.id === l.contactId);
    return { leadId: l.id, emailCheck: p?.emailStatus === "valid" ? /** @type {const} */ ("valid") : /** @type {const} */ ("invalid") };
  });
  return { ok: true, results };
}
