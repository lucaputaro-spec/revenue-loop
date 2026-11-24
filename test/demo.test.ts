import { describe, expect, it } from "vitest";
import { demoData } from "../public/lib/demo.js";

describe("demo data", () => {
  it("is deterministic", () => {
    expect(demoData()).toEqual(demoData());
  });

  it("has the promised shape", () => {
    const d = demoData();
    expect(d.companies).toHaveLength(60);
    expect(d.wonCustomers).toHaveLength(5);
    expect(d.lists.map((l) => l.id)).toEqual(["list-a", "list-b"]);
    expect(d.lists[0]?.segment).toBe("SaaS DACH 50–200");
    expect(new Set(d.companies.map((c) => c.id)).size).toBe(60);
    expect(d.campaign.body).toContain("{{firstName}}");
    expect(d.campaign.body).toContain("{{companyName}}");
    expect(d.leads.every((l) => l.contactId)).toBe(true);
  });

  it("uses only .example domains", () => {
    const d = demoData();
    for (const c of [...d.companies, ...d.wonCustomers]) expect(c.domain).toMatch(/^[a-z0-9-]+\.example$/);
  });

  it("gives list B mostly broken websites", () => {
    const d = demoData();
    const b = d.lists[1]!;
    const valid = b.companyIds.filter((id) => d.companies.find((c) => c.id === id)?.websiteStatus === "valid");
    expect(valid.length / b.companyIds.length).toBeLessThan(0.7);
  });
});
