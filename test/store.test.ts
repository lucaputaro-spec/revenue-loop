import { describe, expect, it } from "vitest";
import { load, reset, save, STORE_KEY, type KeyValue } from "../public/lib/store.js";

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("store", () => {
  it("starts with the demo and round-trips through storage", () => {
    const s = memory();
    const session = load(s);
    expect(session.lists).toHaveLength(2);
    session.log.push("changed");
    save(s, session);
    expect(s.data.has(STORE_KEY)).toBe(true);
    expect(load(s).log).toEqual(["changed"]);
  });

  it("starts fresh on broken or reset data", () => {
    const s = memory();
    s.setItem(STORE_KEY, "{not json");
    expect(load(s).log).toEqual([]);
    save(s, { ...load(s), log: ["x"] });
    expect(reset(s).log).toEqual([]);
    expect(s.data.has(STORE_KEY)).toBe(false);
  });
});
