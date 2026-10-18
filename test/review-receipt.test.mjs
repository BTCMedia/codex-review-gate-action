import test from "node:test";
import assert from "node:assert/strict";

import {
  codexInlineParentReviewBodyHasClosedGrammar,
  parseCodexReviewArtifact,
} from "../src/core.mjs";

/**
 * Regression cover for BTCMedia/btc-inc-os#2537 (the 2026-10-16 variant).
 *
 * From 2026-10-16 Codex prefixes its inline-review parent body with a receipt tag,
 * `<!-- codex-review-receipt:v1 -->`, on its own line above `### 💡 Codex Review`. The parent
 * classifier required the body to START with the heading, so every such review became
 * `unrecognized Codex terminal pull-request-review format`, and one of them turned every later
 * head of the PR into a hard `error`, before Codex had even reviewed the new head.
 *
 * Same posture as the 2026-08 disclosure variant: accept the tag as one exact, optional leading
 * line, and keep every other rule of the closed grammar unchanged.
 */

const COMMIT = "b5d0b58eaef6d1e2f039ab072ba8460e6d190adf";
const BOT = { login: "chatgpt-codex-connector[bot]", type: "Bot" };

// Verbatim body of btc-inc-os#3094 review 5543296412 (2026-10-16), whitespace included.
const RECEIPT_PARENT_BODY = [
  "<!-- codex-review-receipt:v1 -->",
  "",
  "",
  "### 💡 Codex Review",
  "",
  "Here are some automated review suggestions for this pull request.",
  "",
  "**Reviewed commit:** `b5d0b58eae`",
  "    ",
  "",
  "<details> <summary>ℹ️ About Codex in GitHub</summary>",
  "<br/>",
  "",
  "Codex has been enabled to automatically review pull requests in this repo. Reviews are triggered when you",
  "- Open a pull request for review",
  "- Mark a draft as ready",
  '- Comment "@codex review".',
  "",
  "If Codex has suggestions, it will comment; otherwise it will react with 👍.",
  "",
  "",
  "",
  "",
  'When you [sign up for Codex through ChatGPT](https://openai.com/codex), Codex can also answer questions or update the PR, like "@codex address that feedback".',
  "            ",
  "</details>",
].join("\n");

const LEGACY_PARENT_BODY = RECEIPT_PARENT_BODY.replace("<!-- codex-review-receipt:v1 -->\n", "");

function review(body, overrides = {}) {
  return {
    id: 5543296412,
    user: BOT,
    state: "COMMENTED",
    commit_id: COMMIT,
    body,
    submitted_at: "2026-10-16T05:06:00Z",
    html_url: "https://github.com/BTCMedia/btc-inc-os/pull/3094#pullrequestreview-5543296412",
    ...overrides,
  };
}

const parse = (r) => parseCodexReviewArtifact(r, { owner: "BTCMedia", repo: "btc-inc-os" });

test("a receipt-tagged inline parent parses exactly like the legacy body", () => {
  const legacy = parse(review(LEGACY_PARENT_BODY));
  const tagged = parse(review(RECEIPT_PARENT_BODY));
  assert.equal(tagged.reason, legacy.reason);
  assert.equal(tagged.kind, legacy.kind);
  assert.notEqual(tagged.reason, "unrecognized Codex terminal pull-request-review format");
});

test("a receipt-tagged inline parent passes the closed parent grammar", () => {
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(LEGACY_PARENT_BODY)), true);
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(RECEIPT_PARENT_BODY)), true);
});

test("the receipt must be the first line: anywhere else it still breaks the grammar", () => {
  const moved = LEGACY_PARENT_BODY.replace(
    "Here are some automated",
    "<!-- codex-review-receipt:v1 -->\nHere are some automated",
  );
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(moved)), false);
});

test("only the exact v1 tag is accepted, and only once", () => {
  for (const prefix of [
    "<!-- codex-review-receipt:v2 -->",
    "<!-- codex-review-receipt:v1 --> trailing",
    "<!-- codex-review-receipt:v1 -->\n<!-- codex-review-receipt:v1 -->",
    "<!-- anything-else -->",
  ]) {
    const body = `${prefix}\n\n${LEGACY_PARENT_BODY}`;
    assert.equal(
      parse(review(body)).reason,
      "unrecognized Codex terminal pull-request-review format",
      prefix,
    );
    assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(body)), false, prefix);
  }
});

test("the receipt does not relax author or commit binding", () => {
  const human = parse(review(RECEIPT_PARENT_BODY, { user: { login: BOT.login, type: "User" } }));
  assert.equal(human.reason, "configured Codex review author is not a Bot");
  const unbound = parse(review(RECEIPT_PARENT_BODY, { commit_id: "b5d0b58eae" }));
  assert.equal(unbound.reason, "Codex review is not bound to a full commit SHA");
});
