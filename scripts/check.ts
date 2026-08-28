/**
 * Standalone entry point — runs the same check as the /api/check route, but as
 * a plain Node process. This is what the GitHub Actions workflow runs when you
 * haven't deployed to Vercel, so the whole thing works with GitHub alone.
 *
 *   npx tsx scripts/check.ts           # normal hourly run
 *   npx tsx scripts/check.ts --test    # always emails, never marks as seen
 */
import { runCheck, runTest, reportFailure } from "../lib/check";

async function main() {
  const isTest = process.argv.includes("--test");

  if (isTest) {
    // Test mode deliberately doesn't go through reportFailure: it always sends
    // its own email, including when the scrape blows up, so a failure here is
    // still a delivered, informative result rather than a silent one.
    const result = await runTest();

    console.log("--- test run ---");
    if (result.diagnostics) {
      const d = result.diagnostics;
      console.log(`Filters: max rent ${d.maxRent}, radius ${d.radiusKm}km`);
      console.log(`Parsed from Yad2: ${d.totalBeforeFilter}`);
      console.log(`Dropped over price: ${d.droppedByPrice}, too far: ${d.droppedByDistance}`);
      console.log(`Matching: ${d.totalAfterFilter}`);
      for (const [i, p] of d.pages.entries()) {
        console.log(
          `Page ${i + 1}: HTTP ${p.status ?? "?"}, ${p.htmlLength ?? "?"} bytes, ` +
            `__NEXT_DATA__ ${p.foundNextData ? "found" : "MISSING"}, ` +
            `${p.candidateCount} candidates, ${p.parsedCount} parsed`
        );
        console.log(`  content-type: ${p.contentType ?? "(none)"}`);
        if (p.blockers.length > 0) console.log(`  ⚠ bot protection: ${p.blockers.join(", ")}`);
        if (p.error) console.log(`  error: ${p.error}`);
        if (p.bodySnippet) console.log(`  response starts: ${p.bodySnippet.slice(0, 400)}`);
        if (p.sampleRawKeys) console.log(`  sample fields: ${p.sampleRawKeys.join(", ")}`);
        if (p.sampleRaw) console.log(`  sample record: ${p.sampleRaw}`);
      }
    }
    if (result.error) console.error(`Scrape failed:\n${result.error}`);
    console.log("Test email sent — check your inbox.");

    // Exit non-zero on a broken scrape so the run is visibly red in Actions,
    // even though the email itself went out fine.
    if (!result.scrapeOk) process.exitCode = 1;
    return;
  }

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
