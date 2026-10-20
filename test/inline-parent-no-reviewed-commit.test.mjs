import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  codexInlineParentReviewBodyHasClosedGrammar,
  parseCodexReviewArtifact,
} from "../src/core.mjs";

/**
 * Regression cover for BTCMedia/btc-inc-os#3054 (2026-10-20).
 *
 * Codex's receipt-tagged inline-review parent now omits the `**Reviewed commit:**` line. The
 * parent grammar required that line, so the review fell through to the body-findings parser,
 * which wants blob links in the body, and the gate hard-errored ("Codex review evidence is
 * invalid") on every open PR. Accept the omission only for a receipt-tagged body that carries no
 * Reviewed commit line at all; the parent stays bound by its full commit_id.
 */

// Verbatim body of btc-inc-os#3054 review 5586544412 (2026-10-20).
const { body: NO_COMMIT_BODY } = JSON.parse(
  readFileSync(new URL("./inline-parent-no-reviewed-commit.fixture.json", import.meta.url), "utf8"),
);
const COMMIT = "5af34a29284c43b714521553c850ea2e42d34e7a";
const BOT = { login: "chatgpt-codex-connector[bot]", type: "Bot" };
const RECEIPT = "<!-- codex-review-receipt:v1 -->";
const HEADING_LINE = "Here are some automated review suggestions for this pull request.";

function review(body, overrides = {}) {
  return {
    id: 5586544412,
    user: BOT,
    state: "COMMENTED",
    commit_id: COMMIT,
    body,
    submitted_at: "2026-10-20T14:31:26Z",
    html_url: "https://github.com/BTCMedia/btc-inc-os/pull/3054#pullrequestreview-5586544412",
    ...overrides,
  };
}

const parse = (r) => parseCodexReviewArtifact(r, { owner: "BTCMedia", repo: "btc-inc-os" });

test("the fixture is receipt-tagged and has no Reviewed commit line", () => {
  assert.ok(NO_COMMIT_BODY.startsWith(`${RECEIPT}\n`));
  assert.ok(!/Reviewed commit/i.test(NO_COMMIT_BODY));
});

test("a receipt-tagged parent without Reviewed commit passes the closed parent grammar", () => {
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(NO_COMMIT_BODY)), true);
});

test("it routes to the inline-parent path, not 'unrecognized format'", () => {
  // gate.mjs treats a COMMENTED review as an inline parent only when the body parser reports
  // this exact reason AND the parent grammar passes.
  assert.equal(
    parse(review(NO_COMMIT_BODY)).reason,
    "Codex finding must contain only exact full-SHA github.com blob links",
  );
});

test("without the receipt, a missing Reviewed commit line is still rejected", () => {
  const untagged = NO_COMMIT_BODY.replace(`${RECEIPT}\n`, "");
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(untagged)), false);
});

test("a Reviewed commit line anywhere but line 3 is still rejected", () => {
  const misplaced = `${NO_COMMIT_BODY}\n\n**Reviewed commit:** \`5af34a2928\``;
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(misplaced)), false);
});

test("a present Reviewed commit line must still match the parent commit", () => {
  const wrong = NO_COMMIT_BODY.replace(
    HEADING_LINE,
    `${HEADING_LINE}\n\n**Reviewed commit:** \`0123456789\``,
  );
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(wrong)), false);
  const right = NO_COMMIT_BODY.replace(
    HEADING_LINE,
    `${HEADING_LINE}\n\n**Reviewed commit:** \`5af34a2928\``,
  );
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(right)), true);
});

test("extra text in place of the Reviewed commit line is rejected", () => {
  const extra = NO_COMMIT_BODY.replace(HEADING_LINE, `${HEADING_LINE}\n\nSome other line.`);
  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review(extra)), false);
});

test("the omission does not relax state, author or commit binding", () => {
  assert.equal(
    codexInlineParentReviewBodyHasClosedGrammar(review(NO_COMMIT_BODY, { state: "APPROVED" })),
    false,
  );
  assert.equal(
    codexInlineParentReviewBodyHasClosedGrammar(review(NO_COMMIT_BODY, { commit_id: "5af34a2928" })),
    false,
  );
  assert.equal(
    parse(review(NO_COMMIT_BODY, { user: { login: BOT.login, type: "User" } })).reason,
    "configured Codex review author is not a Bot",
  );
});
