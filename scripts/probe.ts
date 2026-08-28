/**
 * Diagnostic probe. Tries several ways of getting rental data out of Yad2 and
 * reports what each one actually returns, so the real scraper can be built on
 * whichever one works instead of on a guess.
 *
 * Needs no secrets — it only reads. Run it from the Actions tab ("Probe Yad2")
 * and read the log.
 *
 *   npx tsx scripts/probe.ts
 */

const AREA_PARAMS = "topArea=41&area=99&maxPrice=5500";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const API_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_HEADERS["User-Agent"],
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: "https://www.yad2.co.il/realestate/rent",
  Origin: "https://www.yad2.co.il",
};

interface Target {
  name: string;
  url: string;
  headers: Record<string, string>;
}

const TARGETS: Target[] = [
  {
    name: "HTML page (browser headers)",
    url: `https://www.yad2.co.il/realestate/rent?${AREA_PARAMS}`,
    headers: BROWSER_HEADERS,
  },
  {
    name: "HTML page (bare, no headers)",
    url: `https://www.yad2.co.il/realestate/rent?${AREA_PARAMS}`,
    headers: {},
  },
  {
    name: "gw realestate-feed/rent",
    url: `https://gw.yad2.co.il/realestate-feed/rent?${AREA_PARAMS}`,
    headers: API_HEADERS,
  },
  {
    name: "gw realestate-feed/rent/map",
    url: `https://gw.yad2.co.il/realestate-feed/rent/map?${AREA_PARAMS}`,
    headers: API_HEADERS,
  },
  {
    name: "gw feed-search-legacy",
    url: `https://gw.yad2.co.il/feed-search-legacy/realestate/rent?${AREA_PARAMS}`,
    headers: API_HEADERS,
  },
  {
    name: "www api pre-load getFeedIndex",
    url: `https://www.yad2.co.il/api/pre-load/getFeedIndex/realestate/rent?${AREA_PARAMS}`,
    headers: API_HEADERS,
  },
  {
    name: "www api feed get",
    url: `https://www.yad2.co.il/api/feed/get?${AREA_PARAMS}&cat=2&subcat=2`,
    headers: API_HEADERS,
  },
];

// Signatures that mean "a bot wall answered", not "the data isn't there".
const BLOCK_SIGNATURES: [string, string][] = [
  ["captcha", "CAPTCHA challenge"],
  ["datadome", "DataDome bot protection"],
  ["px-captcha", "PerimeterX bot protection"],
  ["_px", "PerimeterX bot protection"],
  ["cf-browser-verification", "Cloudflare browser check"],
  ["Just a moment", "Cloudflare interstitial"],
  ["Access Denied", "generic access denial"],
  ["ShieldSquare", "ShieldSquare bot protection"],
  ["Request unsuccessful", "Incapsula/Imperva block"],
  ["Incapsula", "Incapsula/Imperva block"],
];

function detectBlockers(body: string): string[] {
  const lower = body.toLowerCase();
  const hits = new Set<string>();
  for (const [needle, label] of BLOCK_SIGNATURES) {
    if (lower.includes(needle.toLowerCase())) hits.add(label);
  }
  return [...hits];
}

/** Count how many times a plausible listing-shaped key appears in a JSON blob. */
function countListingSignals(body: string): Record<string, number> {
  const keys = ["\"token\"", "\"price\"", "\"adNumber\"", "\"roomsCount\"", "\"coordinates\"", "\"feed_items\"", "\"listings\""];
  const out: Record<string, number> = {};
  for (const k of keys) {
    const n = body.split(k).length - 1;
    if (n > 0) out[k.replace(/"/g, "")] = n;
  }
  return out;
}

async function probe(target: Target): Promise<void> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${target.name}`);
  console.log(`  ${target.url}`);

  try {
    const started = Date.now();
    const res = await fetch(target.url, {
      headers: target.headers,
      redirect: "follow",
    });
    const body = await res.text();
    const ms = Date.now() - started;

    console.log(`  -> HTTP ${res.status} ${res.statusText} in ${ms}ms`);
    console.log(`     content-type: ${res.headers.get("content-type") ?? "(none)"}`);
    console.log(`     final url:    ${res.url}`);
    console.log(`     body length:  ${body.length}`);

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) console.log(`     set-cookie:   ${setCookie.slice(0, 200)}`);

    const blockers = detectBlockers(body);
    if (blockers.length > 0) {
      console.log(`     ⚠ BLOCKERS DETECTED: ${blockers.join(", ")}`);
    }

    const hasNextData = body.includes("__NEXT_DATA__");
    console.log(`     __NEXT_DATA__: ${hasNextData ? "PRESENT" : "absent"}`);

    let isJson = false;
    try {
      JSON.parse(body);
      isJson = true;
    } catch {
      /* not JSON, fine */
    }
    console.log(`     parses as JSON: ${isJson}`);

    const signals = countListingSignals(body);
    if (Object.keys(signals).length > 0) {
      console.log(
        `     listing-ish keys: ${Object.entries(signals)
          .map(([k, v]) => `${k}×${v}`)
          .join(", ")}`
      );
    }

    // The first chunk of the body is what actually tells us what we're looking at.
    console.log(`     --- first 600 chars ---`);
    console.log(
      body
        .slice(0, 600)
        .split("\n")
        .map((l) => `     | ${l}`)
        .join("\n")
    );
  } catch (err) {
    console.log(`  -> THREW: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  console.log("Probing Yad2 access strategies...");
  console.log(`Node ${process.version}, ${new Date().toISOString()}`);

  for (const target of TARGETS) {
    await probe(target);
    // Be a polite client; don't hammer them from a CI runner.
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("Probe complete.");
}

main();
