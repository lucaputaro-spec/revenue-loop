// Firmen-Score gegen die gewonnenen Kunden. Feste Regeln entscheiden: erst
// Muss-Regeln, dann gewichtete Ähnlichkeit zum ähnlichsten Gewinnkunden.
// Die AI darf nur bei Grenzfällen (5–6) um höchstens einen Punkt schieben.
// Fällt sie aus oder ist das Aufruf-Limit erreicht, bleibt der Regel-Score.

import { MAX_AI_CALLS } from "./budget.js";

/**
 * @typedef {import("./demo.js").Company} Company
 * @typedef {import("./budget.js").Budget} Budget
 * @typedef {import("./budget.js").BudgetRefusal} BudgetRefusal
 * @typedef {import("./budget.js").AiLimitRefusal} AiLimitRefusal
 * @typedef {{ id: string, label: string, test: (c: Company) => boolean, reason: (c: Company) => string }} MustRule
 * @typedef {{ company: { name: string, industry: string, description: string }, won: { name: string, description: string }[] }} JudgeInput
 * @typedef {{ adjust: unknown, reason?: unknown, source?: unknown, note?: unknown }} JudgeAnswer
 * @typedef {(input: JudgeInput) => Promise<JudgeAnswer>} JudgeFn
 * @typedef {{
 *   ok: true, companyId: string, score: number | null, rejected: boolean, rule: string | null,
 *   reason: string, source: "Rule" | "Workers AI", note: string, similarity: number | null, nearestId: string | null
 * }} Score
 */

const DACH = ["DE", "AT", "CH"];

/** @type {MustRule[]} */
export const MUST_RULES = [
  { id: "country-in-DACH", label: "Country in DACH", test: (c) => DACH.includes(c.country), reason: (c) => `country ${c.country} is outside DACH` },
  { id: "employees-20-500", label: "20–500 employees", test: (c) => c.employees >= 20 && c.employees <= 500, reason: (c) => `${c.employees} employees, needs 20–500` },
  { id: "not-agency", label: "Not an agency", test: (c) => c.industry !== "Agency", reason: () => "agencies are excluded" },
];

export const WEIGHTS = Object.freeze({ industry: 0.35, employees: 0.25, country: 0.15, motion: 0.15, fundingStage: 0.1 });
export const BORDERLINE = Object.freeze([5, 6]);

/**
 * Größennähe: gleiche Größe 1, Faktor 10 Unterschied oder mehr 0.
 * @param {number} a
 * @param {number} b
 */
function sizeCloseness(a, b) {
  if (a <= 0 || b <= 0) return 0;
  return Math.max(0, 1 - Math.abs(Math.log(a / b)) / Math.log(10));
}

/**
 * Gewichtete Merkmals-Ähnlichkeit, 0 bis 1.
 * @param {Company} a
 * @param {Company} b
 * @returns {number}
 */
export function similarity(a, b) {
  const s =
    (a.industry === b.industry ? WEIGHTS.industry : 0) +
    WEIGHTS.employees * sizeCloseness(a.employees, b.employees) +
    (a.country === b.country ? WEIGHTS.country : 0) +
    (a.motion === b.motion ? WEIGHTS.motion : 0) +
    (a.fundingStage === b.fundingStage ? WEIGHTS.fundingStage : 0);
  return Math.round(s * 1000) / 1000;
}

/**
 * @param {Company} company
 * @param {MustRule[]} [rules]
 * @returns {{ rule: MustRule, reason: string } | null}
 */
export function brokenRule(company, rules = MUST_RULES) {
  const rule = rules.find((r) => !r.test(company));
  return rule ? { rule, reason: rule.reason(company) } : null;
}

/**
 * @param {Company} a
 * @param {Company} b
 */
function sharedTraits(a, b) {
  const out = [];
  if (a.industry === b.industry) out.push("same industry");
  if (sizeCloseness(a.employees, b.employees) >= 0.7) out.push("similar size");
  if (a.country === b.country) out.push("same country");
  if (a.motion === b.motion) out.push("same sales motion");
  if (a.fundingStage === b.fundingStage) out.push("same funding stage");
  return out.length ? out.join(", ") : "little in common";
}

/** @param {number} n */
const clampScore = (n) => Math.min(10, Math.max(1, n));

/**
 * @param {Company} company
 * @param {Company[]} wonCustomers
 * @param {Budget} budget
 * @param {{ judgeFn?: JudgeFn, listId?: string }} [opts]
 * @returns {Promise<Score | BudgetRefusal | AiLimitRefusal>}
 */
export async function scoreCompany(company, wonCustomers, budget, opts = {}) {
  const listId = opts.listId ?? "";
  const lookup = budget.charge("company_lookup", listId);
  if (!lookup.ok) return lookup;

  /** @type {Score} */
  const base = { ok: true, companyId: company.id, score: null, rejected: false, rule: null, reason: "", source: "Rule", note: "", similarity: null, nearestId: null };

  const broken = brokenRule(company);
  if (broken) return { ...base, rejected: true, rule: broken.rule.id, reason: `Rejected by must rule ${broken.rule.id}: ${broken.reason}.` };

  let nearest = null;
  let best = -1;
  for (const w of wonCustomers) {
    const s = similarity(company, w);
    if (s > best) {
      best = s;
      nearest = w;
    }
  }
  if (!nearest) return { ...base, score: 1, similarity: 0, reason: "No won customers to compare with yet." };

  const ruleScore = clampScore(1 + Math.round(best * 9));
  const scored = {
    ...base,
    score: ruleScore,
    similarity: best,
    nearestId: nearest.id,
    reason: `Closest won customer is ${nearest.name} (${Math.round(best * 100)}% similar: ${sharedTraits(company, nearest)}).`,
  };
  if (!BORDERLINE.includes(ruleScore)) return scored;

  // Grenzfall: AI darf um höchstens einen Punkt schieben.
  if (!opts.judgeFn) return { ...scored, note: "Borderline score, no AI judge available, rule score kept." };
  const ai = budget.charge("ai_judgment", listId);
  if (!ai.ok) return { ...scored, note: `Borderline score, AI call limit reached (${MAX_AI_CALLS} per session), rule score kept.` };

  try {
    const answer = await opts.judgeFn({
      company: { name: company.name, industry: company.industry, description: company.description },
      won: wonCustomers.map((w) => ({ name: w.name, description: w.description })),
    });
    if (answer.source === "Rule") {
      const why = typeof answer.note === "string" && answer.note ? answer.note : "AI gave no usable answer";
      return { ...scored, note: `Borderline score, ${why}, rule score kept.` };
    }
    if (typeof answer.adjust !== "number" || !Number.isFinite(answer.adjust)) {
      return { ...scored, note: "Borderline score, AI answer was unusable, rule score kept." };
    }
    const adjust = Math.max(-1, Math.min(1, Math.round(answer.adjust)));
    const why = typeof answer.reason === "string" ? answer.reason.slice(0, 200) : "";
    return { ...scored, score: clampScore(ruleScore + adjust), source: "Workers AI", note: `AI moved the score by ${adjust >= 0 ? "+" : ""}${adjust}${why ? `: ${why}` : ""}.` };
  } catch {
    return { ...scored, note: "Borderline score, AI not available, rule score kept." };
  }
}

/**
 * Bewertet eine ganze Liste. Prüft das Budget für alle Firmen-Abfragen vorab,
 * damit eine Absage nichts halb bucht.
 * @param {Company[]} companies
 * @param {Company[]} wonCustomers
 * @param {Budget} budget
 * @param {{ judgeFn?: JudgeFn, listId?: string }} [opts]
 * @returns {Promise<{ ok: true, scores: Score[] } | BudgetRefusal | AiLimitRefusal>}
 */
export async function scoreList(companies, wonCustomers, budget, opts = {}) {
  const check = budget.afford([{ kind: "company_lookup", count: companies.length }]);
  if (!check.ok) return check;
  /** @type {Score[]} */
  const scores = [];
  for (const c of companies) {
    const r = await scoreCompany(c, wonCustomers, budget, opts);
    if (!r.ok) return r;
    scores.push(r);
  }
  return { ok: true, scores };
}
