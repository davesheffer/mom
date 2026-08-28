import { fetchListingsWithDiagnostics, type FetchDiagnostics, type Listing } from "./yad2";
import { getStorage } from "./storage";
import { sendEmail, buildNewListingsEmail, buildTestEmail } from "./notify";

export interface CheckResult {
  checked: number;
  new: number;
  newIds: string[];
}

/**
 * One full pass: scrape Yad2, drop anything already alerted on, email the rest.
 * Shared by the Vercel API route and the standalone GitHub Actions runner so
 * both paths behave identically.
 */
export async function runCheck(): Promise<CheckResult> {
  const storage = getStorage();

  const { listings } = await fetchListingsWithDiagnostics();
  const ids = listings.map((l) => l.id);
  const newIds = await storage.filterNewIds(ids);
  const newIdSet = new Set(newIds);
  const newListings = listings.filter((l) => newIdSet.has(l.id));

  if (newListings.length > 0) {
    const { subject, text, html } = buildNewListingsEmail(newListings);
    await sendEmail(subject, text, html);
    // Only record them as seen once the email actually went out, so a send
    // failure doesn't cause listings to be silently swallowed.
    await storage.markSeen(newIds);
  }

  return { checked: listings.length, new: newListings.length, newIds };
}

export interface TestResult {
  scrapeOk: boolean;
  listings: Listing[];
  diagnostics: FetchDiagnostics | null;
  error: string | null;
}

/**
 * A end-to-end smoke test that ALWAYS sends an email, whether or not the
 * scrape worked and whether or not the listings are new. That separates the
 * two things that can independently be broken — "can this thing email me?"
 * and "can this thing read Yad2?" — instead of a silent no-op leaving you
 * unable to tell which failed.
 *
 * Deliberately does not mark anything as seen, so a test run can't cause you
 * to miss the real alert for those same listings later.
 */
export async function runTest(): Promise<TestResult> {
  let listings: Listing[] = [];
  let diagnostics: FetchDiagnostics | null = null;
  let error: string | null = null;

  try {
    const result = await fetchListingsWithDiagnostics();
    listings = result.listings;
    diagnostics = result.diagnostics;
  } catch (err) {
    error = err instanceof Error ? (err.stack ?? err.message) : String(err);
  }

  const { subject, text, html } = buildTestEmail(listings, diagnostics, error);
  await sendEmail(subject, text, html);

  return { scrapeOk: error === null, listings, diagnostics, error };
}

/**
 * Best-effort "the checker itself is broken" email, throttled so a persistent
 * failure doesn't produce an hourly inbox flood.
 */
export async function reportFailure(message: string): Promise<void> {
  try {
    const storage = getStorage();
    if (await storage.shouldSendFailureAlert()) {
      await sendEmail(
        "⚠️ Yad2 apartment checker failed",
        `The Yad2 apartment checker failed:\n\n${message}`,
        `<p>The Yad2 apartment checker failed:</p><pre>${message}</pre>`
      );
    }
  } catch (err) {
    console.error("failed to send failure alert:", err);
  }
}
