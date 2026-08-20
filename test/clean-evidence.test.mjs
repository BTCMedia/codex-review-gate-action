import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyCleanEvidenceForHead,
  pullRequestLifecycleEnded,
} from "../src/core.mjs";

/**
 * Regression cover for the codex/review-gate deadlock (BTCMedia/btc-inc-os#1664).
 *
 * Once the gate went green on a head and closed its marker cycle, the next push put it into a
 * permanent `error` — "Codex review evidence is invalid" — that no rerun could clear. With no
 * active marker the gate takes the snapshot-evidence path, finds the newest Codex clean result,
 * sees it does not belong to the current head, and throws. Throwing aborts the run BEFORE a new
 * marker is opened and BEFORE state is written, so the next run re-reads the same stale state and
 * repeats. Self-perpetuating, and `error` is never satisfiable by waiting.
 *
 * The distinction that was missing is stale-but-honest vs invalid:
 *   - the clean result is genuine, just bound to a commit that is not the current head
 *     → open a new cycle and wait for a review of the current head (`pending`);
 *   - the evidence is malformed, duplicated, or ambiguous → keep the hard `error`.
 *
 * NOTE on the reported root cause. The issue describes the trigger as "more commits are pushed",
 * but a fast-forward push already recovered: the ancestor branch returned `pending`. The deadlock
 * needs the clean result's commit to NOT be an ancestor of the current head — i.e. a rebase or a
 * force-push. Verified against the reported incident: `64bb7cc2...7c435b8d` on btc-inc-os#1660
 * compares as `diverged` (behind_by 2), not `ahead`. That matters because it is the case this
 * repo hits constantly — `preview` requires signed commits, so agents routinely
 * `git commit --amend -S` and force-push, orphaning the reviewed head every time.
 */

const HEAD = "7c435b8d41c0e1f2a3b4c5d6e7f8091a2b3c4d5e";
const REVIEWED = "64bb7cc2aabbccddeeff00112233445566778899";

test("a clean result on the current head stays clean", () => {
  const result = classifyCleanEvidenceForHead({
    resolvedSha: HEAD,
    statusSha: HEAD,
    isAncestorOfHead: true,
  });

  assert.equal(result.kind, "clean");
});

test("head comparison is case-insensitive", () => {
  const result = classifyCleanEvidenceForHead({
    resolvedSha: HEAD.toUpperCase(),
    statusSha: HEAD,
    isAncestorOfHead: true,
  });

  assert.equal(result.kind, "clean");
});

test("a clean result on an ancestor waits rather than passing", () => {
  // Never `clean`: reporting success on the current head from an older head's review is the
  // thing the guard exists to prevent, and that stays true.
  const result = classifyCleanEvidenceForHead({
    resolvedSha: REVIEWED,
    statusSha: HEAD,
    isAncestorOfHead: true,
  });

  assert.equal(result.kind, "pending");
  assert.match(result.reason, /prior head/);
  assert.match(result.reason, new RegExp(REVIEWED));
});

test("a clean result on a DIVERGED commit waits instead of hard-erroring", () => {
  // The #1664 deadlock in one assertion. This was `malformed`, which `failIfSnapshotEvidenceIsInvalid`
  // turns into a terminal `error` before any marker or state write happens.
  const result = classifyCleanEvidenceForHead({
    resolvedSha: REVIEWED,
    statusSha: HEAD,
    isAncestorOfHead: false,
  });

  assert.equal(result.kind, "pending");
  assert.notEqual(result.kind, "malformed");
});

test("the diverged reason names both commits and says why a fresh review is needed", () => {
  // The operator reading a red-turned-pending gate needs to know it was a force-push, not a bug.
  const result = classifyCleanEvidenceForHead({
    resolvedSha: REVIEWED,
    statusSha: HEAD,
    isAncestorOfHead: false,
  });

  assert.match(result.reason, new RegExp(REVIEWED));
  assert.match(result.reason, new RegExp(HEAD));
  assert.match(result.reason, /not an ancestor/);
});

test("stale evidence never classifies as malformed, whatever the ancestry", () => {
  for (const isAncestorOfHead of [true, false]) {
    const result = classifyCleanEvidenceForHead({
      resolvedSha: REVIEWED,
      statusSha: HEAD,
      isAncestorOfHead,
    });
    assert.notEqual(result.kind, "malformed", `ancestry=${isAncestorOfHead}`);
  }
});

/**
 * Secondary defect, folded in at the maintainer's request: after a PR merged, two late gate runs
 * wrote `error: PR lifecycle changed before final Codex review evidence snapshot`, leaving a
 * permanently red required check on a merged commit. It reads as "this merged with a failing
 * required check" to anyone auditing history later. A gate run for a PR that is already gone
 * should no-op, not publish a verdict.
 */
test("an open, unmerged PR has not ended its lifecycle", () => {
  assert.equal(
    pullRequestLifecycleEnded({ state: "open", merged: false, merged_at: null }),
    false
  );
});

test("merged and closed PRs are lifecycle-ended, by any of the three signals", () => {
  assert.equal(pullRequestLifecycleEnded({ state: "closed", merged: false }), true);
  assert.equal(pullRequestLifecycleEnded({ state: "open", merged: true }), true);
  assert.equal(
    pullRequestLifecycleEnded({ state: "open", merged_at: "2026-08-19T03:33:17Z" }),
    true
  );
});

test("a missing pull request counts as ended rather than open", () => {
  // Fail-safe direction: if we cannot tell, do not write a status onto it.
  assert.equal(pullRequestLifecycleEnded(undefined), true);
  assert.equal(pullRequestLifecycleEnded(null), true);
});
