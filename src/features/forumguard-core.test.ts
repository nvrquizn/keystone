import assert from "node:assert/strict";
import test from "node:test";
import { isBumpOnly, possibleDuplicate } from "./forumguard-core.js";

test("ForumGuard recognises only short bump-only replies", () => {
  for (const content of [
    "bump", "BUMP!!!", "bumping", "bumping this", "bump this thread",
    "bump again", "bump bump", "bump for visibility", "up", "boost",
  ]) {
    assert.equal(isBumpOnly(content), true, content);
  }
});

test("ForumGuard ignores discussions of the bump rule and meaningful content", () => {
  for (const content of [
    "Why can't we bump?", "bump isn't allowed", "Bumping is prohibited",
    "Please don't bump", "No bump", "Are bumping replies banned?",
    "Bump this? No, please don't.", "I have an additional idea",
    "Bump for a new tiger ability", "bumping the rules is not allowed",
  ]) {
    assert.equal(isBumpOnly(content), false, content);
  }
});

test("Identical short titles are possible duplicates, but generic ones are not", () => {
  assert.equal(possibleDuplicate("Wrestling", [{ id: "1", name: "wrestling" }])?.id, "1");
  assert.equal(possibleDuplicate("Idea", [{ id: "1", name: "idea" }]), null);
  assert.equal(possibleDuplicate("Snow Leopard", [{ id: "2", name: "Snow Leopard" }])?.id, "2");
});

test("Substantially different titles are not automatically matched", () => {
  assert.equal(possibleDuplicate("Snow leopard ability", [{ id: "1", name: "Rhino stats" }]), null);
});
