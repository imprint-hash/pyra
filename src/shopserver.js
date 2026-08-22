/**
 * Start and stop the shop around each mutation.
 *
 * Node caches an imported module for the life of the process, so editing
 * logic.js under a running server changes the file and nothing else — the
 * browser would keep seeing the old rules and every mutation would look
 * "caught" for the wrong reason. Each mutation therefore gets a fresh process.
 */

import { spawn } from "node:child_process";

const PORT = Number(process.env.SHOP_PORT || 4321);
export const SHOP_URL = `http://localhost:${PORT}`;

async function reachable(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(SHOP_URL, { signal: AbortSignal.timeout(1200) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function startShop() {
  const child = spawn(process.execPath, ["app/server.js"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (b) => (stderr += b));

  if (!(await reachable())) {
    child.kill("SIGKILL");
    throw new Error(`shop did not start on ${PORT}. stderr: ${stderr.slice(0, 300)}`);
  }
  return {
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill("SIGTERM");
      setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000);
    }),
  };
}

/** Free the port if a previous run left something listening on it. */
export async function ensurePortFree() {
  try {
    const r = await fetch(SHOP_URL, { signal: AbortSignal.timeout(800) });
    if (r.ok) {
      spawn("pkill", ["-f", "app/server\\.js"], { stdio: "ignore" });
      await new Promise((res) => setTimeout(res, 700));
    }
  } catch { /* nothing listening, which is what we want */ }
}
