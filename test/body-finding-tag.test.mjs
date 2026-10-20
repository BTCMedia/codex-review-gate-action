import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  codexInlineParentReviewBodyHasClosedGrammar,
  parseCodexReviewArtifact,
} from "../src/core.mjs";

/**
 * Regression cover for BTCMedia/btc-inc-os#3106 (2026-10-20).
 *
 * A review whose finding sits in its OWN body (a blob permalink, no inline children) now opens with
 * `<!-- codex-code-review-finding:v1 -->` instead of `### 💡 Codex Review`, so the parser called it
 * "unrecognized Codex terminal pull-request-review format" and the gate hard-errored. Accept the tag
 * once, as the exact first line; everything after it goes through the unchanged body-findings grammar.
 */

// Verbatim body of btc-inc-os#3106 review 5588430983 (2026-10-20).
const { body: TAGGED_BODY } = JSON.parse(
  readFileSync(new URL("./body-finding-tag.fixture.json", import.meta.url), "utf8"),
);
const TAG = "<!-- codex-code-review-finding:v1 -->";
const COMMIT = "8101d67a427192d8252b942158e5901e8d23f236";
const BOT = { login: "chatgpt-codex-connector[bot]", type: "Bot" };

function review(body, overrides = {}) {
  return {
    id: 5588430983,
    user: BOT,
    state: "COMMENTED",
    commit_id: COMMIT,
    body,
    submitted_at: "2026-10-20T16:45:03Z",
    html_url: "https://github.com/BTCMedia/btc-inc-os/pull/3106#pullrequestreview-5588430983",
    ...overrides,
  };
}

const parse = (r) => parseCodexReviewArtifact(r, { owner: "BTCMedia", repo: "btc-inc-os" });
const UNTAGGED = TAGGED_BODY.replace(/^<!-- codex-code-review-finding:v1 -->[ \t]*\n/, "").trim();

test("the fixture opens with the tag and carries one exact blob finding", () => {
  assert.ok(TAGGED_BODY.startsWith(`${TAG}\n`));
  assert.match(TAGGED_BODY, new RegExp(`/blob/${COMMIT}/`));
});

test("a tagged body-findings review parses exactly like the untagged one", () => {
  const legacy = parse(review(UNTAGGED));
  assert.equal(legacy.kind, "finding");
  const tagged = parse(review(TAGGED_BODY));
  assert.deepEqual(tagged, legacy);
  assert.equal(tagged.headSha, COMMIT);
  assert.deepEqual(tagged.samples, ["scripts/orange-pages-parity-ids.mjs:988"]);
});

test("the tag does not relax commit binding: links must match the review commit", () => {
  const other = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(
    parse(review(TAGGED_BODY, { commit_id: other })).reason,
    "Codex review finding links conflict with the parent review commit",
  );
  assert.equal(
    parse(review(TAGGED_BODY, { user: { login: BOT.login, type: "User" } })).reason,
    "configured Codex review author is not a Bot",
  );
});

test("only the exact tag as the first line, once, is accepted", () => {
  for (const prefix of [
    "<!-- codex-code-review-finding:v2 -->",
    `${TAG} trailing`,
    `${TAG}\n${TAG}`,
    `<!-- codex-review-receipt:v1 -->\n${TAG}`,
  ]) {
    assert.equal(
      parse(review(`${prefix}\n\n${UNTAGGED}`)).reason,
      "unrecognized Codex terminal pull-request-review format",
      prefix,
    );
  }
});

test("the tag never makes a body an inline parent", () => {
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(TAGGED_BODY)), false);
});
