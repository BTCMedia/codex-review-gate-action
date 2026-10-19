import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseCodexIssueCommentArtifact } from "../src/core.mjs";

/**
 * Regression cover for BTCMedia/btc-inc-os#2537 (2026-10-19): the clean-result ISSUE COMMENT now
 * carries the same `<!-- codex-review-receipt:v1 -->` first line as the review body. Without
 * stripping it the first line is not a "Codex Review" heading, the comment is not terminal-looking,
 * and the parser returns null: a clean Codex result is silently ignored and the gate never passes.
 */

// Verbatim body of btc-inc-os#3107 issue comment 6263495412 (2026-10-19).
const { body: RECEIPT_CLEAN_BODY } = JSON.parse(
  readFileSync(new URL("./clean-comment-receipt.fixture.json", import.meta.url), "utf8"),
);
const LEGACY_CLEAN_BODY = RECEIPT_CLEAN_BODY.replace("<!-- codex-review-receipt:v1 -->\n\n", "");

function comment(body) {
  return {
    id: 6263495412,
    user: { login: "chatgpt-codex-connector[bot]", type: "Bot" },
    performed_via_github_app: { slug: "chatgpt-codex-connector" },
    created_at: "2026-10-19T08:56:55Z",
    html_url: "https://github.com/BTCMedia/btc-inc-os/pull/3107#issuecomment-6263495412",
    body,
  };
}

const parse = (body) => parseCodexIssueCommentArtifact(comment(body), { owner: "BTCMedia", repo: "btc-inc-os" });

test("the fixture really starts with the receipt line", () => {
  assert.ok(RECEIPT_CLEAN_BODY.startsWith("<!-- codex-review-receipt:v1 -->\n"));
  assert.notEqual(LEGACY_CLEAN_BODY, RECEIPT_CLEAN_BODY);
});

test("a receipt-tagged clean comment parses exactly like the legacy one", () => {
  const legacy = parse(LEGACY_CLEAN_BODY);
  assert.equal(legacy?.kind, "clean");
  assert.deepEqual(parse(RECEIPT_CLEAN_BODY), legacy);
  assert.equal(parse(RECEIPT_CLEAN_BODY).commitRef, "0e29c51b76");
});

test("only the exact v1 tag as the first line is accepted", () => {
  for (const prefix of ["<!-- codex-review-receipt:v2 -->", "<!-- codex-review-receipt:v1 --> x"]) {
    const result = parse(`${prefix}\n\n${LEGACY_CLEAN_BODY}`);
    assert.notEqual(result?.kind, "clean", prefix);
  }
  const doubled = parse(`<!-- codex-review-receipt:v1 -->\n${RECEIPT_CLEAN_BODY}`);
  assert.notEqual(doubled?.kind, "clean");
});

test("a receipt-tagged clean comment still counts as the Codex completion comment", async () => {
  const { isCodexCompletionComment, selectLatestCodexCompletionComment } = await import("../src/core.mjs");
  assert.equal(isCodexCompletionComment(comment(LEGACY_CLEAN_BODY)), true);
  assert.equal(isCodexCompletionComment(comment(RECEIPT_CLEAN_BODY)), true);
  assert.equal(selectLatestCodexCompletionComment([comment(RECEIPT_CLEAN_BODY)])?.id, "6263495412");
  assert.equal(isCodexCompletionComment(comment(`<!-- codex-review-receipt:v2 -->\n\n${LEGACY_CLEAN_BODY}`)), false);
});
