import type { Listing } from "./yad2";

const MAX_LISTINGS_PER_MESSAGE = 10;

export async function sendWhatsApp(message: string): Promise<void> {
  const phone = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) {
    throw new Error("CALLMEBOT_PHONE / CALLMEBOT_APIKEY are not configured");
  }

  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", phone);
  url.searchParams.set("text", message);
  url.searchParams.set("apikey", apikey);

  const res = await fetch(url.toString());
  const body = await res.text();
  if (!res.ok || /error/i.test(body)) {
    throw new Error(`CallMeBot send failed: HTTP ${res.status} - ${body}`);
  }
}

export function buildNewListingsMessage(listings: Listing[]): string {
  const top = listings.slice(0, MAX_LISTINGS_PER_MESSAGE);
  const lines = top.map((l) => {
    const parts = [`₪${l.price}`];
    if (l.rooms) parts.push(`${l.rooms} rooms`);
    if (l.address) parts.push(l.address);
    if (l.distanceKm != null) parts.push(`${l.distanceKm.toFixed(1)}km from Kfar HaRif`);
    return `🏠 ${parts.join(" · ")}\n${l.link}`;
  });

  let message = `New Yad2 apartments near Kfar HaRif (≤₪${process.env.MAX_RENT ?? 5500}):\n\n${lines.join(
    "\n\n"
  )}`;
  if (listings.length > top.length) {
    message += `\n\n+${listings.length - top.length} more (check the site)`;
  }
  return message;
}
