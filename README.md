# Pyra

**Would your tests notice if your app broke?**

A green test suite tells you nothing on its own. It may be watching closely, or
it may be asleep — and both look identical from the outside. Pyra breaks your
application on purpose, one rule at a time, and reports which faults your Kane
flows actually notice.

Built for the [Kane CLI Online Hackathon](https://luma.com/kanecli-online).

---

## The result, on our own app

A four-step Kane flow — buy two shares, confirm the order, open the portfolio,
confirm the holding. It passes 4/4. It is the test a developer would write.

```
$ node src/cli.js sweep

SURVIVED  You can buy shares with money you do not have.
SURVIVED  You can sell shares you never owned.
SURVIVED  A 100-share order is charged as one share.
SURVIVED  You can order minus fifty shares.
SURVIVED  You can order 2.5 shares of a whole-share instrument.
SURVIVED  Orders fill at a price that expired long ago.

Alarm score: 0/100  (0 of 6 faults noticed)
```

Every step green, and the broker would let a £5,000 account buy £841,657 of
stock without turning anything red.

After one repair — described below — the same suite scores **33/100**, catching
two faults including one it was never asked about.

---

## How it works

**1. Break the app.** Six faults, each a single edit to `app/logic.js`: a
balance check that stops running, a total that loses its multiplier, a
short-sale guard that lets you sell shares you never held. Each is applied
alone and then reverted.

**2. Replay the flows.** `kane-cli testmd run` against each fault. A flow that
stays green has been *shown* to be blind, not argued to be.

**3. Repair the test, never the app.** A survived fault is evidence about the
test — we broke the app ourselves and know exactly how. So the flow is handed
to a coding agent, which rewrites it.

**4. Judge the repair twice.** It must **fail** under the fault *and* still
**pass** on a healthy app. Without the second check, "verify an error appears"
would score as a fix while being a worse test than we started with. Failed
repairs are rolled back.

### The loop, closed

```
sweep → fault survives → agent rewrites the flow → Kane replays it twice
      → red under the fault?  green on a healthy app?  → keep, else roll back
```

Kane's result re-prompts the agent; the agent's output is re-run by Kane. When
a rewrite is rejected, the agent is told **which** of the two failures it hit —
they need opposite corrections, and an agent told only "that didn't work"
pushes harder in whichever direction it was already going.

### What the agent produced

Given *"the balance check was removed and your test still passed"*, and shown
the live page, it replaced this:

```markdown
Verify the portfolio lists NVDA.
```

with this:

```markdown
Verify the page shows "Cash: £3315.00".
Verify the page shows "You hold: 2 NVDA".
Clear the "Number of shares" field and type "10". Click "Buy".
Verify the page shows "Not enough cash. This order costs £8425.00."
```

It did the arithmetic itself — £5000 − 2 × £842.50 = £3315.00, and
10 × £842.50 = £8425.00.

That rewrite also caught a **second** fault nobody asked about: asserting an
exact cash figure notices when the order total loses its multiplier. Asserting
"the page lists NVDA" notices nothing.

---

## Why this needs Kane

Mutation testing means re-running your whole suite once per fault. In a real
browser that is normally unaffordable, which is why almost nobody does it.

Kane's `testmd` recording changes the arithmetic:

| | |
|---|---|
| First authoring | ~7 credits, a few minutes |
| **Every replay after** | **0 credits, ~25 seconds** |

Measured: balance `10985.3547` before a seven-replay sweep, `10985.3547`
after. Kane is not incidental here — free deterministic replay is the only
reason the idea is affordable.

Two other Kane features do real work: `--bug-detection` separates "the app is
broken" from "my automation slipped", and the `test_md_summary` event carries
per-step counts that the scorer needs.

---

## Running it

Requires Node 18+, Chrome, and a logged-in `kane-cli`.

```bash
npm install -g @testmuai/kane-cli && kane-cli login
node app/server.js          # the app under test, on :4321

node src/cli.js sweep       # break it six ways, score the flows
node src/cli.js repair      # sweep, repair one survivor, sweep again
node src/cli.js demo        # sweep, repair every survivor, sweep again
```

Reports land in `reports/alarm.html`.

The repair step uses `claude -p` when Claude Code is signed in, and falls back
to any OpenAI-compatible endpoint via `.env` (see `.env.example`).

### On WSL

Kane looks for Chrome at `/usr/bin/google-chrome` and its docs assume you can
`sudo apt install`. Without root, extract it and point Kane at it:

```bash
dpkg-deb -x google-chrome-stable_current_amd64.deb ~/opt/chrome
export KANE_CLI_CHROME_PATH=~/opt/chrome/opt/google/chrome/chrome
```

`libnss3`, `libnspr4` and `libasound2` can be extracted the same way and put on
`LD_LIBRARY_PATH`.

---

## Layout

```
app/logic.js        every rule the broker enforces — the only file faults touch
app/server.js       renders what those rules decide
tests/*_test.md     Kane flows
src/mutate.js       the six faults, and the crash-safe apply/revert
src/sweep.js        the grid: every fault against every flow
src/loop.js         the repair loop and its two acceptance checks
src/report.js       reports/alarm.html
src/cli.js          sweep | repair | demo
```

Every rule lives in one file so a fault is a single honest edit — "this check
no longer runs" — rather than a change scattered through handlers and templates
that would fail for reasons nobody could attribute to it.

---

## Things that bit us, and what we did

**A killed run left a fault on disk.** `finally` does not survive `SIGKILL`, so
a stopped background job left a disabled balance check in the working tree. A
backup file is now written before each edit and restored on next start.

**Kane can report `passed` with failed steps.** Their issue
[#93](https://github.com/LambdaTest/kane-cli/issues/93) documents a
`readonly_fallback` path that does this, and we saw the same path in a clean
run. The scorer reads `steps.failed`, never `overall_status` alone — believing
it would report a caught fault as survived.

**Node caches modules.** Editing `logic.js` under a running server changes the
file and nothing else, so every fault gets a fresh process. Without this, all
six would have looked "caught" for the wrong reason.

**An ungrounded agent invents the app.** Its first repair asserted a balance of
`$0.00` and an error reading `"Insufficient funds"`. The app trades in pounds
and says `"Not enough cash."` It now reads the live page and the exact strings
the rules can emit before writing a single assertion.

---

## Honest limits

- **One app, six faults, hand-written.** Deriving faults from arbitrary source
  is the obvious next step, not a shipped feature.
- **A score of 100 does not mean the app is correct.** It means the flows
  notice *these six* faults.
- **Repairs are bounded at three attempts** and rolled back on failure, so a
  hard fault can simply stay unfixed.
- **Unaudited hackathon code.** It rewrites files in your repository.

## Licence

MIT
