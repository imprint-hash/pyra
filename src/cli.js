#!/usr/bin/env node
/**
 * One command, three verbs.
 *
 *   alarm sweep     break the app six ways, see which faults the flows notice
 *   alarm repair    hand a survivor to the coding agent until the flow catches it
 *   alarm demo      sweep, repair every survivor, sweep again
 *
 * Everything writes reports/alarm.html, because the number on its own is an
 * argument and the table is the evidence.
 */

import { readdir, writeFile, mkdir } from "node:fs/promises";
import { MUTATIONS, restoreIfInterrupted, checkAll } from "./mutate.js";
import { sweep } from "./sweep.js";
import { repair } from "./loop.js";
import { renderReport } from "./report.js";

const LOGIC = "app/logic.js";
const c = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", bold: "\x1b[1m", off: "\x1b[0m" };

async function findTests() {
  const files = await readdir("tests");
  return files.filter((f) => f.endsWith("_test.md")).map((f) => `tests/${f}`);
}

async function writeReport(result, tests) {
  await mkdir("reports", { recursive: true });
  await writeFile("reports/alarm.html",
    renderReport(result, { appName: "Bellweather", testCount: tests.length }));
  await writeFile("reports/sweep.json", JSON.stringify(result, null, 1));
}

function printScore({ score }) {
  if (!score.scorable) {
    console.log(`\n${c.red}No score: no flow was green on a healthy app.${c.off}`);
    console.log(`${c.dim}Fix the flows first — nothing can go red that was already red.${c.off}\n`);
    return;
  }
  const tone = score.alarmScore >= 80 ? c.green : c.red;
  console.log(`\n${c.bold}Alarm score: ${tone}${score.alarmScore}/100${c.off}` +
    `${c.dim}  (${score.caught} of ${score.mutations} faults noticed)${c.off}`);
  if (score.errored) {
    console.log(`${c.red}${score.errored} fault(s) could not be tested — a flow errored rather than ran.${c.off}`);
  }
  console.log(`${c.dim}Report: reports/alarm.html${c.off}\n`);
}

const onSweepEvent = (e) => {
  if (e.phase === "baseline" && e.status === "start") console.log(`${c.dim}Checking the flows are green to begin with…${c.off}`);
  if (e.phase === "mutation" && e.status === "start") process.stdout.write(`${c.dim}  breaking: ${e.mutation}…${c.off}\r`);
  if (e.phase === "mutation" && e.status === "done") {
    const tag = e.caught ? `${c.green}CAUGHT  ${c.off}` : `${c.red}SURVIVED${c.off}`;
    console.log(`${tag}  ${e.describes}`);
  }
};

async function main() {
  const verb = process.argv[2] || "sweep";

  // A previous run may have been killed with a fault still applied. finally
  // does not survive SIGKILL, so the backup does.
  const { restored } = await restoreIfInterrupted(LOGIC);
  if (restored) console.log(`${c.dim}Restored app/logic.js from an interrupted run.${c.off}`);

  const unmatched = (await checkAll(LOGIC)).filter((m) => !m.applies);
  if (unmatched.length) {
    console.error(`${c.red}These faults no longer match ${LOGIC}:${c.off}`);
    unmatched.forEach((m) => console.error(`  ${m.id}`));
    console.error("The application changed. Update src/mutate.js before trusting a score.");
    process.exit(1);
  }

  const tests = await findTests();
  if (!tests.length) { console.error("No *_test.md files in tests/."); process.exit(1); }
  console.log(`${tests.length} flow(s), ${MUTATIONS.length} faults\n`);

  if (verb === "sweep") {
    const result = await sweep(tests, { onEvent: onSweepEvent });
    await writeReport(result, tests);
    return printScore(result);
  }

  if (verb === "repair" || verb === "demo") {
    let result = await sweep(tests, { onEvent: onSweepEvent });
    await writeReport(result, tests);
    printScore(result);

    const survivors = result.grid.filter((g) => !g.caught);
    if (!survivors.length) return console.log("Nothing to repair.");

    // Repair one survivor by default; the whole list only on `demo`.
    const todo = verb === "demo" ? survivors : survivors.slice(0, 1);
    for (const s of todo) {
      const mutation = MUTATIONS.find((m) => m.id === s.id);
      console.log(`${c.bold}Repairing:${c.off} ${s.describes}`);
      const r = await repair(tests[0], mutation, {
        onEvent: (e) => {
          if (e.step === "attempt-judged") {
            console.log(`  attempt ${e.attempt}: ` +
              `${e.redUnderBug ? c.green + "notices the fault" : c.red + "still blind"}${c.off}, ` +
              `${e.greenWhenHealthy ? c.green + "honest on a good app" : c.red + "breaks a good app"}${c.off}`);
          }
        },
      });
      console.log(r.fixed ? `  ${c.green}fixed${c.off}\n` : `  ${c.red}gave up, rolled back${c.off}\n`);
    }

    console.log(`${c.bold}Re-checking…${c.off}`);
    result = await sweep(tests, { onEvent: onSweepEvent });
    await writeReport(result, tests);
    return printScore(result);
  }

  console.error(`Unknown command "${verb}". Try: sweep | repair | demo`);
  process.exit(1);
}

main().catch((e) => { console.error(`${c.red}${e.message}${c.off}`); process.exit(1); });
