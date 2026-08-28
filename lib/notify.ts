import nodemailer from "nodemailer";
import type { Listing } from "./yad2";

const MAX_LISTINGS_PER_MESSAGE = 20;

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
