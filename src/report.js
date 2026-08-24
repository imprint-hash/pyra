/**
 * The report a developer actually looks at.
 *
 * A sweep's useful output is not "6 of 6 survived" but which specific failure
 * would reach production unnoticed, and it has to be legible at a glance —
 * this is the artefact someone opens after a CI run, not a data structure.
 *
 * Written as a self-contained file so it can be opened straight from disk,
 * committed to a PR, or attached to a build. No network, no assets.
 */

const esc = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

const VERDICT = {
  caught: { label: "Caught", tone: "good" },
  survived: { label: "Survived", tone: "bad" },
};

export function renderReport(result, { appName = "the app", testCount = 1 } = {}) {
  const { score, grid, baseline } = result;
  const tone = score.alarmScore >= 80 ? "good" : score.alarmScore >= 40 ? "warn" : "bad";

  const rows = grid.map((g) => {
    const v = VERDICT[g.caught ? "caught" : "survived"];
    return `<tr class="${v.tone}">
      <td><span class="pill ${v.tone}">${v.label}</span></td>
      <td class="what"><strong>${esc(g.describes)}</strong><br><code>${esc(g.id)}</code></td>
      <td class="by">${g.caughtBy.length ? g.caughtBy.map((t) => esc(t.split("/").pop())).join("<br>") : "—"}</td>
    </tr>`;
  }).join("");

  const survivors = grid.filter((g) => !g.caught);
  const worst = survivors[0];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alarm score · ${esc(appName)}</title>
<style>
 :root{--ink:#14161d;--paper:#f6f6f3;--card:#fff;--line:#dededa;--soft:#63636e;
   --good:#0b7a54;--warn:#a86a00;--bad:#c02f22;--goodbg:#e7f5ee;--warnbg:#fdf1dd;--badbg:#fbe9e7}
 @media(prefers-color-scheme:dark){:root{--ink:#eceef4;--paper:#0f1117;--card:#181b23;--line:#2b2f3a;--soft:#9aa0b0;
   --good:#3ac68d;--warn:#e0a33a;--bad:#ff7a68;--goodbg:#0f2c22;--warnbg:#2e2410;--badbg:#2e1614}}
 *{box-sizing:border-box}
 body{margin:0;background:var(--paper);color:var(--ink);
   font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
 .wrap{max-width:860px;margin:0 auto;padding:36px 20px 80px}
 h1{font-size:clamp(24px,4vw,34px);margin:0 0 4px;letter-spacing:-.02em}
 .sub{color:var(--soft);margin:0 0 30px}
 .score{display:flex;align-items:center;gap:22px;background:var(--card);border:1px solid var(--line);
   border-radius:16px;padding:24px 26px;margin-bottom:14px;flex-wrap:wrap}
 .big{font-size:clamp(48px,10vw,76px);font-weight:800;line-height:1;letter-spacing:-.04em;
   font-variant-numeric:tabular-nums}
 .big.good{color:var(--good)}.big.warn{color:var(--warn)}.big.bad{color:var(--bad)}
 .score p{margin:0;max-width:44ch}
 .headline{font-size:18px;font-weight:650;margin-bottom:4px!important}
 table{width:100%;border-collapse:collapse;background:var(--card);
   border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-top:26px}
 th{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--soft);
   text-align:left;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600}
 td{padding:14px 16px;border-bottom:1px solid var(--line);vertical-align:top}
 tr:last-child td{border-bottom:0}
 .pill{display:inline-block;font-size:12px;font-weight:700;padding:3px 11px;border-radius:999px;white-space:nowrap}
 .pill.good{background:var(--goodbg);color:var(--good)}
 .pill.bad{background:var(--badbg);color:var(--bad)}
 code{font:13px ui-monospace,Menlo,Consolas,monospace;color:var(--soft)}
 .by{font-size:13px;color:var(--soft)}
 .note{border-left:3px solid var(--line);padding-left:14px;margin-top:30px;color:var(--soft);font-size:14px}
 .scroll{overflow-x:auto}
</style></head><body><div class="wrap">

<h1>Alarm score</h1>
<p class="sub">${esc(appName)} · ${testCount} flow${testCount === 1 ? "" : "s"} ·
  ${score.mutations} deliberate faults</p>

<div class="score">
  <div class="big ${tone}">${score.alarmScore}<span style="font-size:.4em;font-weight:600">/100</span></div>
  <p>
    <span class="headline">${score.caught} of ${score.mutations} faults were noticed.</span>
    ${survivors.length
      ? `Your flows pass, and ${survivors.length} real bug${survivors.length === 1 ? "" : "s"}
         would still reach production without turning anything red.`
      : `Every fault turned a flow red. These tests are doing their job.`}
  </p>
</div>

${worst ? `<p class="note"><strong>Worst survivor:</strong> ${esc(worst.describes)}
  Nothing in the suite went red when this was true.</p>` : ""}

<div class="scroll"><table>
  <thead><tr><th>Verdict</th><th>Fault injected</th><th>Caught by</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>

<p class="note">
  Each fault is a single edit to the application's rules, applied on its own and then reverted.
  Every flow was green on the healthy app first — ${Object.values(baseline)
    .filter((b) => b.passed).length} of ${Object.keys(baseline).length} passed baseline — so
  "it stayed green" means the flow did not notice, not that it was already broken.
</p>

</div></body></html>`;
}
