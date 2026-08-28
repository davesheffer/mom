/**
 * Standalone entry point — runs the same check as the /api/check route, but as
 * a plain Node process. This is what the GitHub Actions workflow runs when you
 * haven't deployed to Vercel, so the whole thing works with GitHub alone.
 *
 *   npx tsx scripts/check.ts
 */
import { runCheck, reportFailure } from "../lib/check";

async function main() {
  try {
    const result = await runCheck();
    console.log(
      `Checked ${result.checked} listing(s); ${result.new} new.` +
        (result.new > 0 ? ` Emailed: ${result.newIds.join(", ")}` : "")
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("yad2 check failed:", message);
    await reportFailure(message);
    process.exitCode = 1;
  }
}

main();
