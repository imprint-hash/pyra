import { defineVideo } from "tcut";

/**
 * The terminal footage for the Pyra film.
 *
 * This runs the real tool against the real broker — no scripted output, no
 * typed-out fake. The `expect()` calls make the recording assert what it
 * showed, so footage that no longer matches the tool fails the render instead
 * of quietly lying in a demo video.
 *
 *   tcut demo.video.ts
 *
 * Recorded at 30fps and font-size 30 to match the Remotion composition, with
 * no margin or radius so React can draw the card around it.
 */

export default defineVideo(
  {
    output: ["public/sweep.mp4"],
    cols: 92,
    rows: 26,
    fps: 30,
    fontSize: 30,
    theme: "Catppuccin Mocha",
    windowBar: "colorful",
    title: "pyra — zsh",
    margin: 0,
    borderRadius: 0,
    maxPause: "900ms",
    typingSpeed: 34,
    requires: ["node"],
  },
  async (t) => {
    // Environment setup belongs off camera: the audience came for the sweep,
    // not for nvm and a Chrome path.
    await t.hide(async () => {
      await t.run('export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"');
      await t.run('export LD_LIBRARY_PATH="$HOME/opt/chromelibs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"');
      await t.run('export KANE_CLI_CHROME_PATH="$HOME/opt/chrome/opt/google/chrome/chrome"');
      await t.run("cd ~/checkoutbench");
      // The standalone flow below needs the broker up. `sweep` starts and
      // stops its own copy per fault, and clears this one first, so it is
      // only needed for the opening run.
      await t.run("(node app/server.js >/dev/null 2>&1 &) ; sleep 2");
      await t.run("clear");
    });

    await t.chapter("green");
    await t.run("kane-cli testmd run tests/buy_nvda_test.md --headless");
    await t.expect(/passed/i);
    await t.sleep("1.2s");

    await t.chapter("sweep");
    await t.run("clear");
    // The sweep replays a flow per fault, so most of its runtime is Chrome
    // starting. Compressed, not faked: every line still comes from the run.
    await t.timelapse(async () => {
      await t.run("node src/cli.js sweep");
    }, { speed: 6 });
    await t.expect(/Alarm score/i);
    await t.sleep("2s");

    await t.chapter("report");
    await t.run("open reports/alarm.html || echo 'reports/alarm.html written'");
    await t.sleep("1s");
  },
);
