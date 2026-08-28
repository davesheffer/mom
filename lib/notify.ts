import nodemailer from "nodemailer";
import type { Listing, FetchDiagnostics } from "./yad2";

const MAX_LISTINGS_PER_MESSAGE = 20;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD are not configured");
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

export async function sendEmail(subject: string, text: string, html: string): Promise<void> {
  const user = process.env.GMAIL_USER;
  const to = process.env.ALERT_EMAIL_TO || user;
  const transport = getTransport();

  await transport.sendMail({
    from: `Yad2 Apartment Alerts <${user}>`,
    to,
    subject,
    text,
    html,
  });
}

export function buildNewListingsEmail(listings: Listing[]): { subject: string; text: string; html: string } {
  const top = listings.slice(0, MAX_LISTINGS_PER_MESSAGE);
  const maxRent = process.env.MAX_RENT ?? 5500;

  const subject =
    listings.length === 1
      ? "1 new Yad2 apartment near Kfar HaRif"
      : `${listings.length} new Yad2 apartments near Kfar HaRif`;

  const textLines = top.map((l) => {
    const parts = [`₪${l.price}`];
    if (l.rooms) parts.push(`${l.rooms} rooms`);
    if (l.address) parts.push(l.address);
    if (l.distanceKm != null) parts.push(`${l.distanceKm.toFixed(1)}km from Kfar HaRif`);
    return `🏠 ${parts.join(" · ")}\n${l.link}`;
  });
  let text = `New Yad2 apartments near Kfar HaRif (≤₪${maxRent}):\n\n${textLines.join("\n\n")}`;
  if (listings.length > top.length) {
    text += `\n\n+${listings.length - top.length} more (check the site)`;
  }

  const htmlItems = top
    .map((l) => {
      const parts = [`₪${l.price}`];
      if (l.rooms) parts.push(`${l.rooms} rooms`);
      if (l.address) parts.push(l.address);
      if (l.distanceKm != null) parts.push(`${l.distanceKm.toFixed(1)}km from Kfar HaRif`);
      return `<li style="margin-bottom:12px"><a href="${l.link}">${parts.join(" · ")}</a></li>`;
    })
    .join("\n");
  let html = `<p>New Yad2 apartments near Kfar HaRif (≤₪${maxRent}):</p><ul>${htmlItems}</ul>`;
  if (listings.length > top.length) {
    html += `<p>+${listings.length - top.length} more (check the site)</p>`;
  }

  return { subject, text, html };
}

/**
 * The test-run email. Always sent, so receiving it proves the email path works
 * even when the scrape found nothing; the diagnostics block then says why.
 */
export function buildTestEmail(
  listings: Listing[],
  diagnostics: FetchDiagnostics | null,
  error: string | null
): { subject: string; text: string; html: string } {
  const ok = error === null && listings.length > 0;
  const subject = ok
    ? `✅ Yad2 alerts test — found ${listings.length} matching apartment(s)`
    : error !== null
      ? "❌ Yad2 alerts test — the scrape failed"
      : "⚠️ Yad2 alerts test — email works, but no listings matched";

  const summaryLines: string[] = [];
  summaryLines.push(
    "This is a manual test run. It does NOT mark anything as already-seen,",
    "so you'll still get the real alert for these listings later.",
    ""
  );

  if (error !== null) {
    summaryLines.push("The email path works — you're reading this — but reading Yad2 failed:", "", error, "");
  } else if (listings.length === 0) {
    summaryLines.push(
      "The email path works and Yad2 responded, but nothing came through the",
      "filters. The diagnostics below show where the listings were lost.",
      ""
    );
  }

  if (diagnostics) {
    summaryLines.push(
      "--- diagnostics ---",
      `Filters: max rent ₪${diagnostics.maxRent}, radius ${diagnostics.radiusKm}km from Kfar HaRif`,
      `Parsed from Yad2: ${diagnostics.totalBeforeFilter}`,
      `Dropped — over price: ${diagnostics.droppedByPrice}, too far: ${diagnostics.droppedByDistance}`,
      `Remaining: ${diagnostics.totalAfterFilter}`,
      ""
    );
    diagnostics.pages.forEach((p, i) => {
      summaryLines.push(
        `Page ${i + 1}: HTTP ${p.status ?? "?"}, ${p.htmlLength ?? "?"} bytes, ` +
          `__NEXT_DATA__ ${p.foundNextData ? "found" : "MISSING"}, ` +
          `${p.candidateCount} candidate node(s), ${p.parsedCount} parsed`,
        `  ${p.url}`
      );
      if (p.sampleRawKeys) {
        summaryLines.push(`  sample fields: ${p.sampleRawKeys.join(", ")}`);
      }
      if (p.sampleRaw) {
        summaryLines.push(`  sample record: ${p.sampleRaw}`);
      }
      summaryLines.push("");
    });
  }

  const listingLines = listings.slice(0, MAX_LISTINGS_PER_MESSAGE).map((l) => {
    const parts = [`₪${l.price}`];
    if (l.rooms) parts.push(`${l.rooms} rooms`);
    if (l.address) parts.push(l.address);
    if (l.distanceKm != null) parts.push(`${l.distanceKm.toFixed(1)}km from Kfar HaRif`);
    return `🏠 ${parts.join(" · ")}\n${l.link}`;
  });

  const text =
    summaryLines.join("\n") +
    (listingLines.length > 0 ? `--- matching listings ---\n\n${listingLines.join("\n\n")}\n` : "");

  const listingHtml = listings
    .slice(0, MAX_LISTINGS_PER_MESSAGE)
    .map((l) => {
      const parts = [`₪${l.price}`];
      if (l.rooms) parts.push(`${l.rooms} rooms`);
      if (l.address) parts.push(l.address);
      if (l.distanceKm != null) parts.push(`${l.distanceKm.toFixed(1)}km from Kfar HaRif`);
      return `<li style="margin-bottom:12px"><a href="${l.link}">${escapeHtml(parts.join(" · "))}</a></li>`;
    })
    .join("\n");

  const html =
    `<p><strong>Manual test run.</strong> It does not mark anything as already-seen, ` +
    `so you'll still get the real alert for these listings later.</p>` +
    (error !== null
      ? `<p>The email path works — you're reading this — but reading Yad2 failed:</p><pre style="white-space:pre-wrap">${escapeHtml(error)}</pre>`
      : "") +
    (error === null && listings.length === 0
      ? `<p>Email works and Yad2 responded, but nothing came through the filters. ` +
        `The diagnostics below show where the listings were lost.</p>`
      : "") +
    (listingHtml ? `<h3>Matching listings</h3><ul>${listingHtml}</ul>` : "") +
    `<h3>Diagnostics</h3><pre style="white-space:pre-wrap;font-size:12px;background:#f6f6f6;padding:12px">${escapeHtml(
      summaryLines.join("\n")
    )}</pre>`;

  return { subject, text, html };
}
