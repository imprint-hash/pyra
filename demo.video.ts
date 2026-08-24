import { defineVideo } from "tcut";

/**
 * The terminal footage for the Pyra film.
 *
 * This runs the real tool against the real broker — no scripted output, no
 * typed-out fake. `expect()` asserts what the screen showed, so footage that
 * no longer matches the tool fails the render rather than quietly lying in a
 * demo video.
 *
 *   tcut demo.video.ts
 *
 * Only `pyra sweep` is recorded. Kane's own CLI paints a spinner and redraws
 * in place, and tcut waits for the shell prompt to come back — pointing it at
 * a TUI stalls the recording mid-step. The sweep prints plain lines and ends
 * on a value worth waiting for, which is also the shot the film needs.
 *
 * Recorded at 30fps and font-size 30 to match the Remotion composition, with
 * no margin or radius so React draws the card around it.
 */

export default defineVideo(
  {
    output: ["public/sweep.mp4"],
    cols: 92,
    rows: 24,
    fps: 30,
    fontSize: 30,
    theme: "Catppuccin Mocha",
    windowBar: "colorful",
    title: "pyra — zsh",
    margin: 0,
    borderRadius: 0,
    maxPause: "700ms",
    typingSpeed: 32,
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
      await t.run("clear");
    });

    await t.chapter("sweep");

    // Most of the sweep's runtime is Chrome starting once per fault, so it is
    // compressed rather than trimmed: every line still comes from the run.
    // The wait is on the screen, not a timer — the score is the last thing
    // printed, so it is the honest signal that the run finished.
    await t.timelapse(
      async () => {
        // The default wait is 15s; a real sweep restarts Chrome once per fault
        // and takes about three minutes.
        await t.run("node src/cli.js sweep", { wait: /Alarm score/, timeout: "420s" });
      },
      { speed: 5 },
    );

    await t.expect(/Alarm score/);
    await t.expect(/SURVIVED/);
    await t.sleep("2.5s");
  },
);
