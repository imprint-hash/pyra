/**
 * The closed loop — pointed at the test, not the app.
 *
 * The obvious loop is: Kane fails, hand the failure to the coding agent, let
 * it edit the app until Kane passes. That loop optimises for green, and green
 * is exactly what a sleeping test already gives you.
 *
 * A survived mutation says something different. The app was genuinely broken
 * — we broke it ourselves, on purpose, and know precisely how — and the flow
 * did not care. That is evidence about the *test*, so the test is what gets
 * repaired. The app is never touched.
 *
 *   survived mutation
 *     -> Claude is told what broke and that the flow missed it
 *     -> Claude rewrites the flow's steps
 *     -> re-author once, then replay under the same mutation
 *     -> the flow must now go red, and must still be green on a healthy app
 *
 * Both halves of that last line matter. A flow rewritten into "verify the page
 * says an error" would catch the mutation and fail on a working app, which is
 * a worse test than the one we started with.
 */

import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { withMutation } from "./mutate.js";
import { startShop } from "./shopserver.js";
import { replay } from "./sweep.js";

const LOGIC = "app/logic.js";

const PROMPT = `You are repairing a browser test, not application code.

A deliberate fault was injected into the application:

  {describes}

The test below ran against the broken application and still PASSED. It should
have failed. Your job is to add or strengthen steps so this fault cannot slip
past, while keeping the test green against a correct application.

Rules:
- Keep the YAML frontmatter exactly as it is.
- Steps are '## ' headings followed by plain-English instructions.
- Only assert things a correct application genuinely does. Never assert that
  an error appears, unless the step first does something that should be
  refused — then the refusal is the correct behaviour and asserting it is fair.
- Prefer checking a concrete number or message over checking that a page loaded.
- Keep it short. Extra steps cost time on every future run.

Current test file:
---
{test}
---

Return the complete new test file and nothing else. No commentary, no fences.`;

/**
 * Ask the coding agent to rewrite the flow.
 *
 * Two routes, because the agent that repairs the test should be the one the
 * developer already has. `claude -p` is preferred — it is the same Claude Code
 * that wrote this project, so the loop closes on a real coding agent rather
 * than a model bolted on for the demo. When it is not signed in, any
 * OpenAI-compatible endpoint stands in; the prompt and the two acceptance
 * checks are identical either way, so the repair is judged the same however
 * it was produced.
 */
function askAgent(prompt, { timeoutMs = 240000 } = {}) {
  return claudeCode(prompt, timeoutMs).catch((e) => {
    if (!process.env.LLM_API_KEY) throw e;
    return viaApi(prompt);
  });
}

function claudeCode(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("claude timed out")); }, timeoutMs);
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      const text = out.trim();
      // A signed-out Claude Code exits 0 and prints its complaint to stdout,
      // so an empty body is not the only failure worth falling back on.
      if (!text || /not (logged in|authenticated)|OAuth session expired/i.test(text)) {
        return reject(new Error(`claude unavailable: ${(text || err).slice(0, 120)}`));
      }
      resolve(text);
    });
  });
}

async function viaApi(prompt) {
  const base = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "openai/gpt-oss-120b",
      max_tokens: 4000,   // reasoning shares this budget; a tight cap returns an empty answer
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`agent HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("agent returned nothing");
  return text;
}

/** Strip fences the model may add despite being asked not to. */
function cleanTest(text) {
  let t = text.trim();
  const fenced = t.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenced) t = fenced[1].trim();
  if (!t.startsWith("---")) throw new Error("rewritten test lost its frontmatter");
  return t + "\n";
}

/** Author once (so replays have a recording), then replay. */
async function authorAndReplay(testPath) {
  await new Promise((resolve, reject) => {
    const child = spawn("kane-cli", ["testmd", "run", testPath, "--headless", "--timeout", "480", "--agent"],
      { stdio: ["ignore", "ignore", "pipe"] });
    child.on("error", reject);
    child.on("close", () => resolve());
  });
  return replay(testPath);
}

export async function repair(testPath, mutation, { onEvent = () => {} } = {}) {
  const before = await readFile(testPath, "utf8");

  onEvent({ step: "asking-claude", mutation: mutation.id });
  const rewritten = cleanTest(
    await askAgent(PROMPT.replace("{describes}", mutation.describes).replace("{test}", before))
  );
  await writeFile(testPath, rewritten);
  onEvent({ step: "test-rewritten", chars: rewritten.length });

  // Does it now notice the fault?
  onEvent({ step: "checking-under-mutation" });
  const underMutation = await withMutation(LOGIC, mutation, async () => {
    const shop = await startShop();
    try { return await authorAndReplay(testPath); } finally { await shop.stop(); }
  });

  // And is it still honest about a working app?
  onEvent({ step: "checking-healthy-app" });
  const shop = await startShop();
  let healthy;
  try { healthy = await replay(testPath); } finally { await shop.stop(); }

  const fixed = !underMutation.passed && healthy.passed;
  if (!fixed) {
    // A test that fails on a correct app is worse than the one we started
    // with, so an unsuccessful repair is rolled back rather than kept.
    await writeFile(testPath, before);
  }

  onEvent({ step: "done", fixed, underMutation, healthy });
  return { fixed, before, after: rewritten, underMutation, healthy };
}
