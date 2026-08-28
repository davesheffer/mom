import { NextRequest, NextResponse } from "next/server";
import { fetchListings } from "@/lib/yad2";
import { filterNewIds, markSeen, shouldSendFailureAlert } from "@/lib/storage";
import { sendEmail, buildNewListingsEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  const query = req.nextUrl.searchParams.get("secret");
  return header === `Bearer ${secret}` || query === secret;
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET is not set" },
      { status: 500 }
    );
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const listings = await fetchListings();
    const ids = listings.map((l) => l.id);
    const newIds = await filterNewIds(ids);
    const newIdSet = new Set(newIds);
    const newListings = listings.filter((l) => newIdSet.has(l.id));

    if (newListings.length > 0) {
      const { subject, text, html } = buildNewListingsEmail(newListings);
      await sendEmail(subject, text, html);
      await markSeen(newIds);
    }

    return NextResponse.json({
      checked: listings.length,
      new: newListings.length,
      newIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("yad2 check failed:", message);

    try {
      if (await shouldSendFailureAlert()) {
        await sendEmail(
          "⚠️ Yad2 apartment checker failed",
          `The Yad2 apartment checker failed: ${message}`,
          `<p>The Yad2 apartment checker failed:</p><pre>${message}</pre>`
        );
      }
    } catch (notifyErr) {
      console.error("failed to send failure alert:", notifyErr);
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
