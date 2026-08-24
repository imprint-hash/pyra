/**
 * The sweep: every mutation against every flow.
 *
 * For each mutation we restart the shop with the fault in place, replay the
 * flows, and record whether they went red. A flow that stays green has been
 * shown, not argued, to be asleep.
 *
 * Replays cost about a fifth of an authoring run and finish in ~25 seconds, so
 * a full grid is affordable. Authoring happens once, in a separate baseline
 * pass, and never inside the grid — an authoring run adapts itself to whatever
 * the page now says, which is precisely what we are trying to detect.
 */

import { spawn } from "node:child_process";
import { MUTATIONS, withMutation } from "./mutate.js";
import { startShop, ensurePortFree } from "./shopserver.js";

const LOGIC = "app/logic.js";

/** Replay one *_test.md and report what actually happened. */
export function replay(testPath, { timeout = 300 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("kane-cli", [
      "testmd", "run", testPath,
      "--headless", "--timeout", String(timeout), "--agent",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let out = "", err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("close", () => {
      let summary = null;
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const e = JSON.parse(t);
          if (e.type === "test_md_summary") summary = e;
        } catch { /* progress noise */ }
      }
      if (!summary) return reject(new Error(`no summary from kane-cli: ${err.slice(0, 200)}`));

      const steps = summary.steps || {};
      resolve({
        // Never trust overall_status on its own. kane-cli issue #93 documents
        // a readonly_fallback path that reports `passed` with failed steps —
        // and we saw that same path in a clean run. Believing it would report
        // a caught mutation as survived: the wrong answer, stated confidently.
        passed: (steps.failed || 0) === 0 && summary.overall_status === "passed",
        failed: steps.failed || 0,
        total: steps.total || 0,
        durationS: summary.duration_s ?? null,
        healed: Boolean(summary.adaptive_heal?.triggered),
        suspectGreen: summary.overall_status === "passed" && (steps.failed || 0) > 0,
      });
    });
  });
}

async function replayAll(tests) {
  const results = {};
  for (const t of tests) {
    try { results[t] = await replay(t); }
    catch (e) {
      // `errored` is not `failed`. A flow that could not run — no credits, no
      // network, Chrome missing — tells us nothing about whether it would have
      // noticed the fault. Counting it as a catch would let an unusable
      // installation score 100/100, which is the most flattering possible lie.
      results[t] = { passed: false, errored: true, error: e.message, total: 0, failed: 0 };
    }
  }
  return results;
}

export async function sweep(tests, { mutations = MUTATIONS, onEvent = () => {} } = {}) {
  await ensurePortFree();

  // Baseline: the flows must be green on a healthy shop, or "it went red under
  // a mutation" means nothing — it was already red.
  onEvent({ phase: "baseline", status: "start" });
  let shop = await startShop();
  const baseline = await replayAll(tests);
  await shop.stop();
  onEvent({ phase: "baseline", status: "done", baseline });

  const usable = tests.filter((t) => baseline[t]?.passed);
  const broken = tests.filter((t) => !baseline[t]?.passed);

  const grid = [];
  for (const m of mutations) {
    onEvent({ phase: "mutation", status: "start", mutation: m.id });
    const row = await withMutation(LOGIC, m, async () => {
      shop = await startShop();
      const r = await replayAll(usable);
      await shop.stop();
      return r;
    });

    // Only a flow that ran and went red has caught anything.
    const caughtBy = usable.filter((t) => !row[t].passed && !row[t].errored);
    const errored = usable.filter((t) => row[t].errored);
    const result = {
      id: m.id,
      describes: m.describes,
      caught: caughtBy.length > 0,
      caughtBy,
      errored,
      perTest: row,
    };
    grid.push(result);
    onEvent({ phase: "mutation", status: "done", ...result });
  }

  const caught = grid.filter((g) => g.caught).length;
  const errored = grid.filter((g) => g.errored.length).length;

  return {
    tests: usable,
    excluded: broken,
    baseline,
    grid,
    score: {
      mutations: grid.length,
      caught,
      survived: grid.length - caught,
      errored,
      // A score needs a flow that was green to begin with. With none, nothing
      // could go red, and reporting 0/100 would blame the tests for what is
      // actually a broken setup.
      scorable: usable.length > 0 && grid.length > 0,
      alarmScore: usable.length && grid.length ? Math.round((caught / grid.length) * 100) : null,
    },
  };
}
