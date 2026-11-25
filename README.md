# Revenue Loop: closed-loop outbound, with evidence

A browser demo of an outbound system that closes the loop. Every lead moves
through a fixed transition table, and every step needs evidence. A campaign
starts only after three gates pass. Every won deal seeds a new lookalike list,
so revenue can be traced back to the list and segment it came from. A
simulated cost budget stops queries before they overspend.

**Demo data: invented companies, simulated costs, no real outcomes.** All
domains end in `.example`. Nothing is sent, nothing is bought.

**Live:** https://revenue-loop.lucaputaro.workers.dev — start with the “Try it in one minute” box at the top.

## What it shows

- **Transition table.** `list_built → verified → contacted → replied →
  positive → booked → closed_won`, plus bounced, unsubscribed,
  not_interested and closed_lost. Each row names its evidence (email check,
  passed gate report, reply id, meeting time, deal value …). A move that is
  not in the table, or lacks evidence, is refused and the lead stays where it is.
- **Three gates before a campaign.** List gate: at least 70% valid websites
  and no broken must rule. Person gate: a fixed sample of 10 contacts, at
  least 80% in target roles. Campaign gate: every template variable filled
  and every company scored. Each gate shows value, threshold and every finding.
- **Score against won customers.** Must rules first (DACH, 20–500
  employees, no agencies), then weighted similarity to the closest won
  customer, 1 to 10, with a one-sentence reason. Only borderline scores (5–6)
  go to Workers AI, which may move them by at most one point. If the AI is
  down or the session limit of 30 calls is used up, the rule score stays.
- **Lookalike list from every win.** Up to 10 companies with similarity of at
  least 0.6 that are not in any list yet, linked to the parent list.
- **Revenue by list and segment.** Meetings, won revenue, cost from the
  ledger, cost per meeting and revenue per euro. Reply rate is a side column.
- **Simulated budget.** €5 per session by default, hard cap €20. Every query
  is checked before it runs. If the budget is short, the page asks before
  raising the limit, and "No" charges nothing.

## Run it

```bash
npm install
npm run dev
npm run test:run && npm run typecheck && npm run lint
```

`npm run dev` needs a Wrangler login, because the AI binding runs remotely.
Without AI, borderline scores keep their rule score.

## Structure

| File | Role |
|---|---|
| `public/lib/transitions.js` | Transition table, `createLead`, `applyTransition` (the only place that changes a lead's state) |
| `public/lib/gates.js` | List, person and campaign gate, `runGates`, `canStart`, simulated email check |
| `public/lib/score.js` | Must rules, similarity, score 1–10, AI nudge for borderline cases |
| `public/lib/lookalike.js` | New list from a won lead |
| `public/lib/report.js` | Revenue, cost and meetings by list and segment |
| `public/lib/budget.js` | Simulated costs, ledger in whole cents, limit and hard cap |
| `public/lib/demo.js` | Seeded demo data: 60 companies, 5 won customers, 2 lists |
| `public/lib/store.js` | Save and load in `localStorage` |
| `public/app.js` | The page, the only caller of `lib/` |
| `src/index.ts`, `src/judge.ts` | Worker: serves the page and `POST /api/judge` |

## Stack

Cloudflare Workers, Workers AI, TypeScript checks on JSDoc-typed ES modules,
Vitest. Plain HTML, CSS and ES modules, no build step. Data stays in the
browser.
