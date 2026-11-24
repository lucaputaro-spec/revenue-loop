// Demo-Daten. Alle Firmen und Personen sind erfunden, alle Domains enden auf
// .example (reserviert, kann nie echt sein). Fester Startwert: jeder Aufruf
// liefert exakt dieselben Daten.

import { createLead } from "./transitions.js";

/**
 * @typedef {{
 *   id: string, name: string, domain: string, industry: string, employees: number, country: string,
 *   motion: "Sales-led" | "Product-led" | "Hybrid", fundingStage: string, description: string,
 *   websiteStatus: "valid" | "invalid"
 * }} Company
 * @typedef {{ id: string, companyId: string, firstName: string, lastName: string, title: string, emailStatus: "valid" | "invalid" }} Contact
 * @typedef {{ id: string, name: string, segment: string, parentListId: string | null, seedCompanyId: string | null, companyIds: string[] }} List
 * @typedef {{ id: string, name: string, listId: string, subject: string, body: string }} Campaign
 * @typedef {{
 *   companies: Company[], wonCustomers: Company[], contacts: Contact[], lists: List[],
 *   leads: import("./transitions.js").Lead[], campaign: Campaign, targetRoles: string[]
 * }} Demo
 */

export const DEMO_SEED = 20261124;
export const DEMO_NOTE = "Demo data: invented companies, simulated costs, no real outcomes";

export const TARGET_ROLES = ["Head of Sales", "VP Sales", "Chief Revenue Officer", "Sales Director", "Head of Revenue Operations"];

/**
 * Kleiner deterministischer Zufallsgenerator (mulberry32).
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIX = ["Nord", "Alp", "Kessel", "Lumen", "Fjord", "Brix", "Talon", "Quarz", "Wellen", "Fels", "Orbit", "Hafen"];
const SUFFIX = ["soft", "flow", "werk", "base", "logic", "stack"];
const FIRST = ["Anna", "Jonas", "Lea", "Felix", "Mara", "Paul", "Sofia", "Elias", "Nina", "Lukas", "Clara", "Tim"];
const LAST = ["Berger", "Hoffmann", "Keller", "Brandt", "Vogel", "Schmid", "Lang", "Fuchs", "Wolf", "Roth"];
const OTHER_ROLES = ["Office Manager", "Marketing Intern", "Software Engineer", "HR Lead"];

const DESCRIBE = /** @type {Record<string, string>} */ ({
  SaaS: "B2B software for planning and reporting, sold to mid-sized teams",
  "E-commerce": "Online shop for home and garden products",
  Fintech: "Payment and invoicing tools for small businesses",
  Agency: "Marketing agency running paid ads for clients",
  Manufacturing: "Maker of industrial sensors and parts",
});

/**
 * @template T
 * @param {T[]} arr
 * @param {() => number} rnd
 * @returns {T}
 */
function pick(arr, rnd) {
  const v = arr[Math.floor(rnd() * arr.length)];
  if (v === undefined) throw new Error("empty array");
  return v;
}

/**
 * @param {() => number} rnd
 * @param {number} lo
 * @param {number} hi
 */
const between = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/**
 * Profil je Firmenblock. 0–11: Liste A (passt), 12–21: Liste B (viele kaputte
 * Websites), 22–59: Rest des Universums für Lookalikes.
 * @param {number} i
 * @param {() => number} rnd
 * @returns {Omit<Company, "id" | "name" | "domain" | "description">}
 */
function profile(i, rnd) {
  if (i < 12) {
    return {
      industry: "SaaS",
      employees: between(rnd, 50, 200),
      country: pick(["DE", "AT", "CH"], rnd),
      motion: pick(["Sales-led", "Hybrid"], rnd),
      fundingStage: pick(["Series A", "Series B"], rnd),
      websiteStatus: i === 3 || i === 8 ? "invalid" : "valid",
    };
  }
  if (i < 22) {
    return {
      industry: "E-commerce",
      employees: between(rnd, 20, 100),
      country: pick(["DE", "AT"], rnd),
      motion: "Product-led",
      fundingStage: "Bootstrapped",
      websiteStatus: i % 5 === 0 || i % 5 === 3 ? "valid" : "invalid",
    };
  }
  // Ungefähr jede zweite Firma im Rest ähnelt den Gewinnkunden.
  if (i % 2 === 0) {
    return {
      industry: "SaaS",
      employees: between(rnd, 40, 250),
      country: pick(["DE", "AT", "CH"], rnd),
      motion: pick(["Sales-led", "Hybrid", "Product-led"], rnd),
      fundingStage: pick(["Seed", "Series A", "Series B"], rnd),
      websiteStatus: rnd() < 0.85 ? "valid" : "invalid",
    };
  }
  return {
    industry: pick(["Fintech", "E-commerce", "Agency", "Manufacturing"], rnd),
    employees: between(rnd, 5, 2000),
    country: pick(["DE", "FR", "NL", "UK", "AT"], rnd),
    motion: pick(["Sales-led", "Product-led", "Hybrid"], rnd),
    fundingStage: pick(["Bootstrapped", "Seed", "Series A", "Series C"], rnd),
    websiteStatus: rnd() < 0.8 ? "valid" : "invalid",
  };
}

/** @param {string} name */
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** @returns {Demo} */
export function demoData() {
  const rnd = seededRandom(DEMO_SEED);
  const names = PREFIX.flatMap((p) => SUFFIX.map((s) => `${p}${s}`));

  /** @type {Company[]} */
  const companies = [];
  for (let i = 0; i < 60; i++) {
    const name = names[(i * 7) % names.length] ?? `Company${i}`;
    const p = profile(i, rnd);
    companies.push({
      id: `c${String(i + 1).padStart(2, "0")}`,
      name,
      domain: `${slug(name)}.example`,
      description: DESCRIBE[p.industry] ?? "",
      ...p,
    });
  }

  /** @type {Company[]} */
  const wonCustomers = [
    ["Brightdesk", 120, "DE", "Sales-led", "Series A"],
    ["Kontorline", 85, "AT", "Hybrid", "Series B"],
    ["Seilbahn Data", 160, "CH", "Sales-led", "Series B"],
    ["Mittelweg", 70, "DE", "Hybrid", "Series A"],
    ["Pultwerk", 190, "DE", "Sales-led", "Series B"],
  ].map(([name, employees, country, motion, fundingStage], i) => ({
    id: `w${i + 1}`,
    name: String(name),
    domain: `${slug(String(name))}.example`,
    industry: "SaaS",
    employees: Number(employees),
    country: String(country),
    motion: /** @type {Company["motion"]} */ (motion),
    fundingStage: String(fundingStage),
    description: DESCRIBE.SaaS ?? "",
    websiteStatus: "valid",
  }));

  /** @type {Contact[]} */
  const contacts = companies.map((c, i) => {
    let title = pick(TARGET_ROLES, rnd);
    // Liste A: genau eine Person außerhalb der Zielrollen. Liste B: gemischt.
    if (i === 5 || (i >= 12 && i < 22 && i % 2 === 1) || (i >= 22 && i % 4 === 3)) title = pick(OTHER_ROLES, rnd);
    return {
      id: `p${String(i + 1).padStart(2, "0")}`,
      companyId: c.id,
      firstName: pick(FIRST, rnd),
      lastName: pick(LAST, rnd),
      title,
      emailStatus: i === 7 || i === 15 ? "invalid" : "valid",
    };
  });

  /** @type {List[]} */
  const lists = [
    { id: "list-a", name: "List A", segment: "SaaS DACH 50–200", parentListId: null, seedCompanyId: null, companyIds: companies.slice(0, 12).map((c) => c.id) },
    { id: "list-b", name: "List B", segment: "E-commerce DACH 20–100", parentListId: null, seedCompanyId: null, companyIds: companies.slice(12, 22).map((c) => c.id) },
  ];

  const leads = lists.flatMap((list) =>
    list.companyIds.map((companyId) => {
      const contact = contacts.find((p) => p.companyId === companyId);
      return createLead({ listId: list.id, segment: list.segment, companyId, contactId: contact?.id ?? "" });
    }),
  );

  /** @type {Campaign} */
  const campaign = {
    id: "camp-1",
    name: "Outbound wave 1",
    listId: "list-a",
    subject: "Pipeline reviews at {{companyName}}",
    body: "Hi {{firstName}}, teams like {{companyName}} often lose deals between first reply and booked meeting. Worth a short call?",
  };

  return { companies, wonCustomers, contacts, lists, leads, campaign, targetRoles: [...TARGET_ROLES] };
}
