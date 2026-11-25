import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, possibleDuplicate, titleSimilarity, isBumpOnly, RollingCounter } from "../src/features/forumguard-core.ts";

test("normalization collapses punctuation and case", () => {
  assert.equal(normalizeTitle("  BAN: Mixpackers!! "), "ban mixpackers");
});
test("three-word duplicate titles are detected", () => {
  assert.equal(possibleDuplicate("Snow Leopard Speed", [{ id: "1", name: "snow leopard speed" }])?.id, "1");
});
test("different ideas and single-word animal names are not presumed duplicates", () => {
  assert.equal(possibleDuplicate("Ban Mixpackers", [{ id: "2", name: "Remove mixpacking penalties" }]), null);
  assert.equal(possibleDuplicate("Jaguar", [{ id: "3", name: "Jaguar" }]), null);
  assert.equal(titleSimilarity("Tiger stats", "Water biome"), 0);
});
test("only bump-only replies are detected", () => {
  assert.equal(isBumpOnly("BUMPPPP!!!"), true);
  assert.equal(isBumpOnly("I think stamina needs a bump"), false);
});
test("rolling windows forget expired timestamps", () => {
  const counter = new RollingCounter();
  assert.equal(counter.add("test", 1, 100), 1);
  assert.equal(counter.add("test", 2, 100), 2);
  assert.equal(counter.add("test", 200, 100), 1);
});
