// Die Seite. Einzige Stelle, die lib/ aufruft. Regeln dazu:
// - Zustände ändern sich nur über applyTransition(), nie direkt.
// - Start einer Kampagne nur über canStart(); der Übergang nach contacted
//   verlangt zusätzlich den bestandenen Bericht als Nachweis.
// - Nach jedem closed_won baut die Seite sofort die Lookalike-Liste. Scheitert
//   das (z. B. Budget-„Nein“), bekommt der Lead einen Knopf zum Nachbauen.
// - Jede simulierte Abfrage geht über das Budget. Reicht es nicht, fragt die
//   Seite per confirm(). Bei „Nein“ läuft keine Abfrage und nichts wird gebucht.
// Inhalte werden nur als Text eingesetzt, nie als HTML.

import { COST_NOTE, COSTS, createBudget, HARD_CAP_EUR, MAX_AI_CALLS, toEur } from "./lib/budget.js";
import { DEMO_NOTE } from "./lib/demo.js";
import { canStart, checkEmails, runGates } from "./lib/gates.js";
import { buildLookalikeList, missingLookalikes } from "./lib/lookalike.js";
import { revenueReport } from "./lib/report.js";
import { scoreList } from "./lib/score.js";
import { load, reset, save } from "./lib/store.js";
import { applyTransition, findTransition, inState, STATES } from "./lib/transitions.js";

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false || kid === "") continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const eur = (n) => `€${n.toFixed(2)}`;
const pct = (n) => (n === null ? "–" : `${Math.round(n * 100)}%`);
const money = (n) => `€${Math.round(n).toLocaleString("en-US")}`;
const now = () => new Date().toISOString();

let db = load(localStorage);
let budget = createBudget(undefined, db.budget);
let movingLeadId = null;
let moveTo = null;
let moveMessage = null;

function persist() {
  db.budget = budget.snapshot();
  save(localStorage, db);
}

function log(text) {
  db.log.unshift(`${new Date().toLocaleTimeString("en-GB")} ${text}`);
  db.log = db.log.slice(0, 60);
}

const company = (id) => db.companies.find((c) => c.id === id);
const contact = (id) => db.contacts.find((p) => p.id === id);
const listById = (id) => db.lists.find((l) => l.id === id);
const leadsOf = (listId) => db.leads.filter((l) => l.listId === listId);
const latestReport = (listId) => [...db.reports].reverse().find((r) => r.listId === listId) ?? null;

function replaceLead(next) {
  db.leads = db.leads.map((l) => (l.id === next.id ? next : l));
}

/* ---------- Budget ---------- */

// Führt eine Aktion aus. Lehnt das Budget ab, fragt die Seite nach einem
// höheren Limit (raiseCap, nie über HARD_CAP_EUR) und versucht es dann erneut.
async function withBudget(label, attempt) {
  let r = await attempt();
  while (r && r.ok === false && r.reason === "budget") {
    const proposal = budget.proposeCap(Math.round(r.needed * 100));
    if (proposal === null) {
      alert(`${label} needs ${eur(r.needed)} (simulated), but the hard cap is ${eur(HARD_CAP_EUR)}. Nothing was charged.`);
      log(`${label}: not run, would pass the hard cap. Nothing charged.`);
      return null;
    }
    const yes = confirm(
      `${label} needs ${eur(r.needed)} (simulated). Only ${eur(r.remaining)} is left of your ${eur(toEur(budget.capCents()))} limit.\n\n` +
        `Raise the limit to ${eur(proposal)}?`,
    );
    if (!yes) {
      log(`${label}: cancelled at the budget limit. Nothing charged.`);
      return null;
    }
    const raised = budget.raiseCap(proposal);
    if (!raised.ok) {
      log(`${label}: limit not raised (${raised.reason}). Nothing charged.`);
      return null;
    }
    log(`Limit raised to ${eur(proposal)}.`);
    r = await attempt();
  }
  return r;
}

/* ---------- AI-Urteil ---------- */

async function judgeFn(input) {
  const res = await fetch("/api/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`judge answered ${res.status}`);
  return res.json();
}

/* ---------- Aktionen ---------- */

async function scoreListAction(listId) {
  const list = listById(listId);
  const companies = list.companyIds.map(company).filter(Boolean);
  const r = await withBudget(`Scoring ${list.name}`, () => scoreList(companies, db.wonCustomers, budget, { judgeFn, listId }));
  if (r && r.ok) {
    for (const s of r.scores) db.scores[s.companyId] = s;
    const ai = r.scores.filter((s) => s.source === "Workers AI").length;
    log(`Scored ${r.scores.length} companies in ${list.name} (${ai} nudged by AI).`);
  }
  persist();
  render();
}

async function checkEmailsAction(listId) {
  const list = listById(listId);
  const waiting = leadsOf(listId).filter((l) => inState(l, "list_built"));
  if (!waiting.length) {
    log(`${list.name}: no leads waiting at list_built.`);
    render();
    return;
  }
  const r = await withBudget(`Email check for ${list.name}`, () => checkEmails(waiting, db.contacts, budget));
  if (r && r.ok) {
    let moved = 0;
    const refused = [];
    for (const res of r.results) {
      const lead = db.leads.find((l) => l.id === res.leadId);
      const t = applyTransition(lead, "verified", { emailCheck: res.emailCheck }, now());
      if (t.ok) {
        replaceLead(t.lead);
        moved += 1;
      } else refused.push(`${company(lead.companyId)?.name}: ${t.reason}`);
    }
    log(`Email check ${list.name}: ${moved} verified, ${refused.length} stay at list_built${refused.length ? ` (${refused.join("; ")})` : ""}.`);
  }
  persist();
  render();
}

async function runGatesAction() {
  const list = listById(db.campaign.listId);
  const id = `rep-${db.nextReportNo}`;
  const r = await withBudget(`Gates for ${list.name}`, () =>
    runGates(
      { id, campaign: db.campaign, list, companies: db.companies, contacts: db.contacts, leads: db.leads, scores: db.scores, targetRoles: db.targetRoles },
      budget,
    ),
  );
  if (r && r.ok) {
    db.reports.push(r.report);
    db.nextReportNo += 1;
    log(`Gate report ${id} for ${list.name}: ${r.report.pass ? "all gates passed" : "blocked"}.`);
  }
  $("#start-result").replaceChildren();
  persist();
  render();
}

function startCampaignAction() {
  const list = listById(db.campaign.listId);
  const report = latestReport(list.id);
  const decision = canStart(report);
  const out = $("#start-result");
  if (!decision.ok) {
    out.replaceChildren(h("div", { class: "blocked" }, h("strong", {}, `Campaign blocked for ${list.name}`), h("ul", {}, decision.reasons.map((x) => h("li", {}, x)))));
    log(`Start blocked for ${list.name}: ${decision.reasons.join("; ")}.`);
    persist();
    renderLog();
    return;
  }
  const ready = leadsOf(list.id).filter((l) => inState(l, "verified"));
  let moved = 0;
  for (const lead of ready) {
    const t = applyTransition(lead, "contacted", { gateReportId: report.id, gateReport: report, campaignId: db.campaign.id }, now());
    if (t.ok) {
      replaceLead(t.lead);
      moved += 1;
    }
  }
  const msg = moved
    ? `Campaign started on ${list.name} with report ${report.id}: ${moved} leads contacted (simulated, nothing sent).`
    : `Gates passed, but ${list.name} has no verified leads. Run “Check emails” first.`;
  out.replaceChildren(h("p", { class: moved ? "ok" : "hint" }, msg));
  log(msg);
  persist();
  render();
}

async function afterWon(lead) {
  const r = await withBudget("Lookalike list", () => buildLookalikeList(lead, { companies: db.companies, contacts: db.contacts }, db.lists, budget));
  if (r && r.ok) {
    db.lists.push(r.list);
    db.leads.push(...r.leads);
    log(`Closed won → new list “${r.list.name}” with ${r.leads.length} leads at list_built.`);
  } else if (r && r.ok === false) {
    log(`Closed won, but no lookalike list (${r.reason}).`);
  } else {
    log("Closed won, lookalike list not built (budget not raised). Use “Build lookalike list” on the lead to retry.");
  }
}

async function rebuildLookalike(leadId) {
  const lead = db.leads.find((l) => l.id === leadId);
  if (!lead) return;
  await afterWon(lead);
  persist();
  render();
}

/* ---------- Übergang mit Nachweis ---------- */

const EVIDENCE_FIELDS = {
  emailCheck: { label: "Email check result", type: "select", options: ["valid", "invalid"] },
  gateReportId: { label: "Gate report", type: "report" },
  campaignId: { label: "Campaign id", type: "text", value: () => db.campaign.id },
  replyId: { label: "Reply id", type: "text", placeholder: "e.g. reply-001" },
  bounceCode: { label: "Bounce code", type: "text", placeholder: "e.g. 550" },
  unsubscribeAt: { label: "Unsubscribed at", type: "date" },
  replyClass: { label: "Reply class", type: "select", options: ["positive", "neutral", "negative"] },
  meetingAt: { label: "Meeting at", type: "datetime-local" },
  dealId: { label: "Deal id", type: "text", placeholder: "e.g. deal-001" },
  dealValue: { label: "Deal value in € (simulated)", type: "number" },
  lostReason: { label: "Lost reason", type: "text", placeholder: "e.g. no budget" },
};

// Vorauswahl: der erste erlaubte Folgezustand. Angeboten werden trotzdem alle.
const firstAllowed = (lead) => STATES.find((s) => findTransition(lead.state, s)) ?? STATES[0];

function openMove(leadId) {
  movingLeadId = leadId;
  moveMessage = null;
  moveTo = firstAllowed(db.leads.find((l) => l.id === leadId));
  renderMove();
  $("#move").hidden = false;
  $("#move").scrollIntoView({ behavior: "smooth", block: "start" });
}

function evidenceInput(key) {
  const f = EVIDENCE_FIELDS[key] ?? { label: key, type: "text" };
  const id = `ev-${key}`;
  let input;
  if (f.type === "select") input = h("select", { id, name: key }, f.options.map((o) => h("option", { value: o }, o)));
  else if (f.type === "report") {
    const opts = [...db.reports].reverse().map((r) => h("option", { value: r.id }, `${r.id} · ${listById(r.listId)?.name ?? r.listId} · ${r.pass ? "passed" : "blocked"}`));
    input = h("select", { id, name: key }, h("option", { value: "" }, "choose a report"), opts);
  } else input = h("input", { id, name: key, type: f.type, placeholder: f.placeholder, value: f.value ? f.value() : undefined, step: f.type === "number" ? "1" : undefined });
  return h("div", { class: "field" }, h("label", { for: id }, f.label), input);
}

function renderMove() {
  const lead = db.leads.find((l) => l.id === movingLeadId);
  if (!lead) {
    $("#move").hidden = true;
    return;
  }
  const c = company(lead.companyId);
  $("#move-lead").replaceChildren(h("strong", {}, c?.name ?? lead.companyId), ` · ${lead.listId} · now `, h("code", {}, lead.state));
  const sel = $("#move-to");
  sel.replaceChildren(...STATES.map((s) => h("option", { value: s }, findTransition(lead.state, s) ? s : `${s} (not allowed from here)`)));
  sel.value = moveTo ?? STATES[0];
  const row = findTransition(lead.state, sel.value);
  $("#move-rule").textContent = row
    ? `Rule: ${row.from} → ${row.to} on “${row.trigger}”. Evidence needed: ${Object.keys(row.evidence).join(", ")}.`
    : `No row ${lead.state} → ${sel.value} in the transition table. Applying will be refused.`;
  // Alle Nachweis-Felder anbieten, die zum Zielzustand passen können; die Tabelle entscheidet.
  const keys = row ? Object.keys(row.evidence) : [];
  $("#move-evidence").replaceChildren(...keys.map(evidenceInput));
  showMoveMessage();
}

function showMoveMessage() {
  $("#move-result").replaceChildren(...(moveMessage ? [h("span", { class: moveMessage.ok ? "ok" : "bad" }, moveMessage.text)] : []));
}

async function applyMove(event) {
  event.preventDefault();
  const lead = db.leads.find((l) => l.id === movingLeadId);
  if (!lead) return;
  const to = $("#move-to").value;
  const evidence = {};
  for (const el of $("#move-evidence").querySelectorAll("input, select")) {
    const raw = el.value.trim();
    if (!raw) continue;
    evidence[el.name] = el.name === "dealValue" ? Number(raw) : raw;
  }
  if (evidence.gateReportId) evidence.gateReport = db.reports.find((r) => r.id === evidence.gateReportId);

  const t = applyTransition(lead, to, evidence, now());
  const name = company(lead.companyId)?.name ?? lead.id;
  if (!t.ok) {
    moveMessage = { ok: false, text: `Refused: ${t.reason}. ${name} stays at ${lead.state}.` };
    log(`${name}: move to ${to} refused (${t.reason}).`);
    persist();
    showMoveMessage();
    renderLog();
    return;
  }
  replaceLead(t.lead);
  moveTo = firstAllowed(t.lead);
  moveMessage = { ok: true, text: `${name} moved to ${to}.` };
  log(`${name}: ${lead.state} → ${to}.`);
  if (inState(t.lead, "closed_won")) await afterWon(t.lead);
  persist();
  render();
}

/* ---------- Anzeige ---------- */

function renderBudget() {
  const cap = budget.capCents();
  const spent = budget.spentCents();
  $("#budget-meter").style.width = `${cap ? Math.min(100, (spent / cap) * 100) : 100}%`;
  $("#budget-text").replaceChildren(
    h("strong", {}, `${eur(toEur(spent))} spent`),
    ` of ${eur(toEur(cap))} limit · ${eur(toEur(budget.remainingCents()))} left · AI calls ${budget.aiCalls()}/${MAX_AI_CALLS} · hard cap ${eur(HARD_CAP_EUR)}`,
  );
  if (document.activeElement !== $("#cap")) $("#cap").value = toEur(cap).toFixed(2);
  $("#cost-note").textContent =
    `Costs are ${COST_NOTE}: company lookup ${eur(toEur(COSTS.company_lookup))}, email check ${eur(toEur(COSTS.email_check))}, ` +
    `contact lookup ${eur(toEur(COSTS.contact_lookup))}, AI judgment ${eur(toEur(COSTS.ai_judgment))} (counts against ${MAX_AI_CALLS} calls per session).`;
  const ledger = budget.ledger();
  $("#ledger").replaceChildren(
    ledger.length
      ? h(
          "table",
          { class: "compact" },
          h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Kind"), h("th", {}, "List"), h("th", { class: "num" }, "Cost"))),
          h("tbody", {}, [...ledger].reverse().map((e) => h("tr", {}, h("td", {}, e.seq), h("td", {}, e.kind), h("td", {}, e.listId || "–"), h("td", { class: "num" }, eur(toEur(e.cents)))))),
        )
      : h("p", { class: "hint" }, "No charges yet."),
  );
}

function renderLists() {
  const head = h("thead", {}, h("tr", {}, ["List", "Segment", "From", "Companies", "Scored", "Actions"].map((x) => h("th", {}, x))));
  const body = h(
    "tbody",
    {},
    db.lists.map((l) => {
      const scored = l.companyIds.filter((id) => db.scores[id]).length;
      const seed = l.seedCompanyId ? company(l.seedCompanyId)?.name : null;
      return h(
        "tr",
        {},
        h("td", {}, h("strong", {}, l.name), h("div", { class: "hint" }, l.id)),
        h("td", {}, l.segment),
        h("td", {}, l.parentListId ? `from ${l.parentListId}${seed ? ` (seed: ${seed})` : ""}` : "–"),
        h("td", { class: "num" }, l.companyIds.length),
        h("td", { class: "num" }, `${scored}/${l.companyIds.length}`),
        h(
          "td",
          { class: "actions" },
          h("button", { type: "button", class: "small", onclick: () => scoreListAction(l.id) }, "Score companies"),
          h("button", { type: "button", class: "small ghost", onclick: () => checkEmailsAction(l.id) }, "Check emails"),
        ),
      );
    }),
  );
  $("#lists").replaceChildren(head, body);
}

function renderCampaign() {
  const sel = $("#campaign-list");
  sel.replaceChildren(...db.lists.map((l) => h("option", { value: l.id }, `${l.name} · ${l.segment}`)));
  sel.value = db.campaign.listId;
  $("#template").textContent = `Subject: ${db.campaign.subject}\n\n${db.campaign.body}`;
  const report = latestReport(db.campaign.listId);
  if (!report) {
    $("#gate-report").replaceChildren(h("p", { class: "hint" }, "No gate report for this list yet."));
    return;
  }
  $("#gate-report").replaceChildren(
    h("p", {}, h("strong", {}, `Report ${report.id}`), ` · ${report.pass ? "all three gates passed" : "blocked"}`),
    h(
      "ul",
      { class: "gates" },
      report.gates.map((g) =>
        h(
          "li",
          { class: g.pass ? "ok" : "bad" },
          h("strong", {}, g.pass ? "Pass " : "Fail "),
          g.summary,
          g.failures.length
            ? h(
                "details",
                {},
                h("summary", {}, `${g.failures.length} findings`),
                h("ul", {}, g.failures.map((f) => h("li", {}, `${company(f.id)?.name ?? contact(f.id)?.lastName ?? f.id} (${f.id}): ${f.reason}`))),
              )
            : null,
        ),
      ),
    ),
  );
}

function scoreCell(lead) {
  const s = db.scores[lead.companyId];
  if (!s) return h("td", { class: "hint" }, "not scored");
  if (s.rejected) return h("td", {}, h("span", { class: "bad" }, "rejected"), h("div", { class: "hint" }, s.rule));
  return h("td", { class: "num" }, `${s.score}/10`, h("div", { class: "hint" }, s.source));
}

function renderLeads() {
  const filter = $("#lead-filter");
  const chosen = filter.value || "all";
  filter.replaceChildren(h("option", { value: "all" }, "All lists"), ...db.lists.map((l) => h("option", { value: l.id }, l.name)));
  filter.value = db.lists.some((l) => l.id === chosen) ? chosen : "all";
  const shown = filter.value === "all" ? db.leads : leadsOf(filter.value);
  const missing = new Set(missingLookalikes(db.leads, db.lists).map((l) => l.id));
  const head = h("thead", {}, h("tr", {}, ["Company", "Contact", "List", "State", "Score", "Why", ""].map((x) => h("th", {}, x))));
  const body = h(
    "tbody",
    {},
    shown.map((lead) => {
      const c = company(lead.companyId);
      const p = contact(lead.contactId);
      const s = db.scores[lead.companyId];
      return h(
        "tr",
        {},
        h("td", {}, h("strong", {}, c?.name ?? lead.companyId), h("div", { class: "hint" }, `${c?.domain ?? ""} · ${c?.industry ?? ""}, ${c?.employees ?? "?"} people, ${c?.country ?? ""}`)),
        h("td", {}, p ? `${p.firstName} ${p.lastName}` : "–", h("div", { class: "hint" }, p?.title ?? "")),
        h("td", {}, lead.listId, h("div", { class: "hint" }, lead.segment)),
        h("td", {}, h("code", { class: "state" }, lead.state)),
        scoreCell(lead),
        h("td", { class: "why" }, s ? s.reason : "", s?.note ? h("div", { class: "hint" }, s.note) : null),
        h(
          "td",
          {},
          h("button", { type: "button", class: "small", onclick: () => openMove(lead.id) }, "Move to…"),
          missing.has(lead.id) ? h("button", { type: "button", class: "small", onclick: () => rebuildLookalike(lead.id) }, "Build lookalike list") : null,
        ),
      );
    }),
  );
  $("#leads").replaceChildren(head, body);
}

function reportTable(rows, withParent) {
  const head = h(
    "thead",
    {},
    h("tr", {}, [withParent ? "List" : "Segment", "Leads", "Contacted", "Meetings", "Won", "Revenue", "Cost", "Cost / meeting", "Revenue / €", "Reply rate"].map((x) => h("th", {}, x))),
  );
  const body = h(
    "tbody",
    {},
    rows.map((r) => {
      const l = withParent ? listById(r.key) : null;
      const contacted = r.leads - r.states.list_built - r.states.verified;
      return h(
        "tr",
        {},
        h("td", {}, h("strong", {}, r.label), l ? h("div", { class: "hint" }, `${l.id}${l.parentListId ? ` · from ${l.parentListId}` : ""}`) : null),
        h("td", { class: "num" }, r.leads),
        h("td", { class: "num" }, contacted),
        h("td", { class: "num" }, r.booked),
        h("td", { class: "num" }, r.won),
        h("td", { class: "num strong" }, money(r.wonRevenue)),
        h("td", { class: "num" }, eur(r.cost)),
        h("td", { class: "num" }, r.costPerMeeting === null ? "–" : eur(r.costPerMeeting)),
        h("td", { class: "num" }, r.revenuePerEuro === null ? "–" : money(r.revenuePerEuro)),
        h("td", { class: "num side" }, pct(r.replyRate)),
      );
    }),
  );
  return [head, body];
}

function renderReport() {
  const r = revenueReport(db.leads, db.lists, budget.ledger());
  $("#report-lists").replaceChildren(...reportTable(r.byList, true));
  $("#report-segments").replaceChildren(...reportTable(r.bySegment, false));
  $("#report-note").textContent = `Revenue is the deal value entered at closed_won (simulated). Cost comes from the ledger by list.${r.unassignedCost ? ` ${eur(r.unassignedCost)} not tied to a list.` : ""}`;
}

function renderLog() {
  $("#log").replaceChildren(...(db.log.length ? db.log.map((x) => h("li", {}, x)) : [h("li", { class: "hint" }, "Nothing yet. Start with “Score companies” on List A.")]));
}

function render() {
  renderBudget();
  renderLists();
  renderCampaign();
  renderLeads();
  if (movingLeadId) renderMove();
  renderReport();
  renderLog();
}

/* ---------- Ereignisse ---------- */

$("#demo-note").textContent = DEMO_NOTE;

$("#cap-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = Number($("#cap").value);
  const current = toEur(budget.capCents());
  // Erhöhen nur über raiseCap (bis zum harten Limit), Senken über setCap.
  const r = value > current ? budget.raiseCap(value) : budget.setCap(value);
  $("#cap-note").textContent = r.ok ? `Limit set to ${eur(value)}.` : `Not changed: ${r.reason}.`;
  if (r.ok) log(`Limit set to ${eur(value)}.`);
  persist();
  render();
});

$("#reset").addEventListener("click", () => {
  if (!confirm("Reset the demo? All moves, lists, scores and charges are cleared.")) return;
  db = reset(localStorage);
  budget = createBudget(undefined, db.budget);
  movingLeadId = null;
  $("#move").hidden = true;
  $("#start-result").replaceChildren();
  persist();
  render();
});

$("#campaign-list").addEventListener("change", (e) => {
  db.campaign = { ...db.campaign, listId: e.target.value };
  $("#start-result").replaceChildren();
  persist();
  render();
});

$("#run-gates").addEventListener("click", () => runGatesAction());
$("#start-campaign").addEventListener("click", () => startCampaignAction());
$("#lead-filter").addEventListener("change", () => renderLeads());
$("#move-to").addEventListener("change", (e) => {
  moveTo = e.target.value;
  moveMessage = null;
  renderMove();
});
$("#move-form").addEventListener("submit", applyMove);
$("#move-close").addEventListener("click", () => {
  movingLeadId = null;
  $("#move").hidden = true;
});

render();
