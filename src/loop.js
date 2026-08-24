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

THE REAL PAGE. This is what the healthy application actually shows. Use this
wording exactly — do not invent labels, currencies, or error text:

{page}

THE ONLY MESSAGES THIS APPLICATION CAN PRODUCE. If you assert an error, it
must be one of these, word for word:

{messages}

Rules:
- Keep the YAML frontmatter exactly as it is. Emit '---' exactly twice.
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

/**
 * What the healthy app actually shows, and what it can actually say.
 *
 * The first repair we ran asserted a cash balance of "$0.00" and an error
 * reading "Insufficient funds". The app is in pounds and says "Not enough
 * cash." The agent had never seen the page — it wrote a test for an
 * application it imagined, which is the same failure that killed our first
 * four Kane runs. Reading the page costs nothing, so there is no reason to
 * ask for assertions without it.
 */
async function groundingFor(testPath) {
  const front = (await readFile(testPath, "utf8")).match(/^---\n([\s\S]*?)\n---/);
  const url = front?.[1].match(/url:\s*(\S+)/)?.[1];
  if (!url) throw new Error("test has no url: in its frontmatter");

  const shop = await startShop();
  let visible = "";
  try {
    const html = await (await fetch(url)).text();
    visible = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
      .split("\n").map((s) => s.trim()).filter(Boolean)
      .join("\n").slice(0, 1200);
  } finally { await shop.stop(); }

  // Every user-facing string the rules can emit, straight from the source.
  const logic = await readFile(LOGIC, "utf8");
  const messages = [...logic.matchAll(/reason:\s*"([^"]+)"|errors\.\w+\s*=\s*[`"]([^`"]+)/g)]
    .map((m) => m[1] || m[2])
    .filter(Boolean);

  return { page: visible, messages: [...new Set(messages)].map((m) => `  - ${m}`).join("\n") };
}

/**
 * Strip fences and repair frontmatter the model may mangle.
 *
 * A rewrite that opens with two `---` lines is not a broken idea, only a
 * broken file, and throwing away an otherwise good repair over a duplicated
 * delimiter wastes a Kane run to find out.
 */
function cleanTest(text) {
  let t = text.trim();
  const fenced = t.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenced) t = fenced[1].trim();
  t = t.replace(/^(?:---\s*\n)+/, "---\n");
  if (!t.startsWith("---")) throw new Error("rewritten test lost its frontmatter");
  if ((t.match(/^---$/gm) || []).length < 2) throw new Error("frontmatter is not closed");
  return t + "\n";
}

/**
 * Author once (so replays have a recording), then replay.
 *
 * A failed authoring run is fatal rather than ignored: the recording on disk
 * would still be the *previous* version of the test, so the replay that
 * follows would judge the old assertions and report a verdict about a rewrite
 * that never ran.
 */
async function authorAndReplay(testPath) {
  await new Promise((resolve, reject) => {
    const child = spawn("kane-cli", ["testmd", "run", testPath, "--headless", "--timeout", "480", "--agent"],
      { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("close", (code) => {
      // Authoring exits non-zero when the rewritten test fails, which is
      // expected here — it is being authored against a broken app. Only a
      // crash, where nothing was written, is fatal.
      if (code === null) return reject(new Error(`authoring was killed: ${err.slice(0, 200)}`));
      resolve();
    });
  });
  return replay(testPath);
}

/**
 * Why an attempt was rejected, phrased for the agent rather than for a log.
 *
 * The two failures need opposite corrections and must never be described the
 * same way: a test that stays green under the fault is not watching closely
 * enough, while one that fails on a healthy app is watching for the wrong
 * thing. Told only "that didn't work", an agent tends to push harder in
 * whichever direction it was already going.
 */
function critique({ underMutation, healthy }) {
  if (underMutation.passed) {
    return "Your last attempt still PASSED while the fault was present. It is not " +
           "checking anything the fault changes. Assert a specific value or message " +
           "that is different when the fault is present.";
  }
  return "Your last attempt correctly failed on the broken application, but it ALSO " +
         "failed on the healthy one — so it is now a broken test. Every step must " +
         "succeed against a correct application. Only assert a refusal after a step " +
         "that genuinely should be refused, and use the exact wording listed above.";
}

export async function repair(testPath, mutation, { onEvent = () => {}, attempts = 3 } = {}) {
  const before = await readFile(testPath, "utf8");

  onEvent({ step: "reading-the-real-page" });
  const ground = await groundingFor(testPath);

  const basePrompt = PROMPT
    .replace("{describes}", mutation.describes)
    .replace("{page}", ground.page)
    .replace("{messages}", ground.messages)
    .replace("{test}", before);

  const tries = [];
  let feedback = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    onEvent({ step: "asking-agent", mutation: mutation.id, attempt });
    let rewritten;
    try {
      rewritten = cleanTest(await askAgent(feedback ? `${basePrompt}\n\n${feedback}` : basePrompt));
    } catch (e) {
      // A malformed file is worth one more try; it says nothing about whether
      // the agent understood the problem.
      feedback = `Your last attempt was rejected before it could run: ${e.message}`;
      tries.push({ attempt, error: e.message });
      continue;
    }
    await writeFile(testPath, rewritten);
    onEvent({ step: "test-rewritten", attempt, chars: rewritten.length });

    // Does it now notice the fault?
    onEvent({ step: "checking-under-mutation", attempt });
    const underMutation = await withMutation(LOGIC, mutation, async () => {
      const shop = await startShop();
      try { return await authorAndReplay(testPath); } finally { await shop.stop(); }
    });

    // And is it still honest about a working app?
    onEvent({ step: "checking-healthy-app", attempt });
    const shop = await startShop();
    let healthy;
    try { healthy = await replay(testPath); } finally { await shop.stop(); }

    const fixed = !underMutation.passed && healthy.passed;
    tries.push({ attempt, fixed, redUnderBug: !underMutation.passed, greenWhenHealthy: healthy.passed });
    onEvent({ step: "attempt-judged", attempt, fixed, redUnderBug: !underMutation.passed,
              greenWhenHealthy: healthy.passed });

    if (fixed) {
      onEvent({ step: "done", fixed: true, attempts: attempt, tries });
      return { fixed: true, before, after: rewritten, underMutation, healthy, tries };
    }

    feedback = critique({ underMutation, healthy });
  }

  // A test that fails on a correct app is worse than the one we started with,
  // so an unsuccessful repair is rolled back rather than kept.
  const last = await readFile(testPath, "utf8");
  await writeFile(testPath, before);
  onEvent({ step: "done", fixed: false, attempts, tries });
  return { fixed: false, before, after: last, tries };
}
