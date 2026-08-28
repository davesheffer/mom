import { KFAR_HARIF, haversineKm } from "./geo";

export interface Listing {
  id: string;
  price: number;
  rooms: number | string | null;
  address: string;
  link: string;
  image: string | null;
  distanceKm: number | null;
}

const DEFAULT_SEARCH_URL =
  "https://www.yad2.co.il/realestate/rent?topArea=41&area=99";

const MAX_RENT = Number(process.env.MAX_RENT ?? 5500);
const RADIUS_KM = Number(process.env.RADIUS_KM ?? 20);
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 2);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: "https://www.yad2.co.il/",
};

/**
 * Yad2 has no documented public API, and its exact listing JSON schema can't be
 * verified from this build environment (outbound access to yad2.co.il is
 * blocked here). Instead of hardcoding a guessed schema, we walk the page's
 * embedded __NEXT_DATA__ tree and heuristically pick out anything that looks
 * like a listing (has a numeric price + an id-like field). This is more
 * resilient to Yad2 changing internal field nesting than a hardcoded path.
 */
function collectCandidateNodes(node: unknown, out: Record<string, any>[], seen: Set<unknown>) {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) collectCandidateNodes(item, out, seen);
    return;
  }

  const obj = node as Record<string, any>;
  const hasPrice = typeof obj.price === "number" && obj.price > 0;
  const idField = obj.token ?? obj.adNumber ?? obj.order_id ?? obj.orderId ?? obj.id;
  if (hasPrice && idField != null) {
    out.push(obj);
  }

  for (const key of Object.keys(obj)) {
    collectCandidateNodes(obj[key], out, seen);
  }
}

function firstDefined<T>(...values: (T | undefined | null)[]): T | null {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

function normalize(raw: Record<string, any>): Listing {
  const token = raw.token ?? raw.adNumber ?? raw.order_id ?? raw.orderId ?? raw.id;
  const id = String(token);

  const address = firstDefined<string>(
    [raw.address?.city?.text, raw.address?.neighborhood?.text, raw.address?.street?.text]
      .filter(Boolean)
      .join(", ") || undefined,
    raw.city,
    raw.address?.city,
    raw.neighborhood,
    ""
  ) as string;

  const lat = firstDefined<number>(
    raw.coordinates?.latitude,
    raw.address?.coords?.lat,
    raw.mapCoordinates?.latitude,
    raw.lat
  );
  const lon = firstDefined<number>(
    raw.coordinates?.longitude,
    raw.address?.coords?.lon,
    raw.mapCoordinates?.longitude,
    raw.lon ?? raw.lng
  );

  const distanceKm =
    typeof lat === "number" && typeof lon === "number"
      ? haversineKm(KFAR_HARIF, { lat, lon })
      : null;

  const link = raw.token
    ? `https://www.yad2.co.il/realestate/item/${raw.token}`
    : firstDefined<string>(raw.link, "") ?? "";

  const image = firstDefined<string>(
    raw.metaData?.coverImage,
    Array.isArray(raw.images) ? raw.images[0] : undefined,
    raw.image
  );

  return {
    id,
    price: Number(raw.price),
    rooms: firstDefined(raw.additionalDetails?.roomsCount, raw.roomsCount, raw.rooms),
    address,
    link,
    image,
    distanceKm,
  };
}

function extractNextData(html: string): unknown {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw new Error(
      "Could not find __NEXT_DATA__ in Yad2 response (page structure changed, or the request was blocked by Yad2's anti-bot protection)"
    );
  }
  return JSON.parse(match[1]);
}

/**
 * Notes from each fetch, so a failing scrape can be diagnosed from a log or a
 * test email rather than by guessing. The parsing here was written against
 * Yad2's public URL structure but has not been verified against a live
 * response, so `sampleRawKeys` / `sampleRaw` matter: if the parse comes back
 * empty, they show what the payload actually looks like.
 */
export interface PageDiagnostics {
  url: string;
  status: number | null;
  htmlLength: number | null;
  foundNextData: boolean;
  candidateCount: number;
  parsedCount: number;
  sampleRawKeys: string[] | null;
  sampleRaw: string | null;
  error: string | null;
}

export interface FetchDiagnostics {
  pages: PageDiagnostics[];
  totalBeforeFilter: number;
  totalAfterFilter: number;
  maxRent: number;
  radiusKm: number;
  droppedByPrice: number;
  droppedByDistance: number;
}

async function fetchPage(
  baseUrl: string,
  page: number
): Promise<{ listings: Listing[]; diagnostics: PageDiagnostics }> {
  const url = new URL(baseUrl);
  url.searchParams.set("maxPrice", String(MAX_RENT));
  if (page > 1) url.searchParams.set("page", String(page));

  const diagnostics: PageDiagnostics = {
    url: url.toString(),
    status: null,
    htmlLength: null,
    foundNextData: false,
    candidateCount: 0,
    parsedCount: 0,
    sampleRawKeys: null,
    sampleRaw: null,
    error: null,
  };

  const res = await fetch(url.toString(), { headers: BROWSER_HEADERS });
  diagnostics.status = res.status;
  if (!res.ok) {
    diagnostics.error = `Yad2 request failed: HTTP ${res.status}`;
    throw new Error(diagnostics.error);
  }

  const html = await res.text();
  diagnostics.htmlLength = html.length;

  const nextData = extractNextData(html);
  diagnostics.foundNextData = true;

  const candidates: Record<string, any>[] = [];
  collectCandidateNodes(nextData, candidates, new Set());
  diagnostics.candidateCount = candidates.length;

  if (candidates.length > 0) {
    diagnostics.sampleRawKeys = Object.keys(candidates[0]);
    diagnostics.sampleRaw = JSON.stringify(candidates[0]).slice(0, 1200);
  }

  const seenIds = new Set<string>();
  const listings: Listing[] = [];
  for (const raw of candidates) {
    const listing = normalize(raw);
    if (!listing.id || Number.isNaN(listing.price)) continue;
    if (seenIds.has(listing.id)) continue;
    seenIds.add(listing.id);
    listings.push(listing);
  }
  diagnostics.parsedCount = listings.length;

  return { listings, diagnostics };
}

export async function fetchListingsWithDiagnostics(): Promise<{
  listings: Listing[];
  diagnostics: FetchDiagnostics;
}> {
  const baseUrl = process.env.YAD2_SEARCH_URL || DEFAULT_SEARCH_URL;

  const diagnostics: FetchDiagnostics = {
    pages: [],
    totalBeforeFilter: 0,
    totalAfterFilter: 0,
    maxRent: MAX_RENT,
    radiusKm: RADIUS_KM,
    droppedByPrice: 0,
    droppedByDistance: 0,
  };

  const all: Listing[] = [];
  const allIds = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { listings: pageListings, diagnostics: pageDiag } = await fetchPage(baseUrl, page);
    diagnostics.pages.push(pageDiag);
    if (pageListings.length === 0) break;

    let addedNew = false;
    for (const listing of pageListings) {
      if (!allIds.has(listing.id)) {
        allIds.add(listing.id);
        all.push(listing);
        addedNew = true;
      }
    }
    // Pagination param isn't verified against the live site; if a later
    // page just repeats page 1, stop instead of looping pointlessly.
    if (!addedNew && page > 1) break;
  }

  diagnostics.totalBeforeFilter = all.length;

  const filtered = all.filter((listing) => {
    if (listing.price > MAX_RENT) {
      diagnostics.droppedByPrice++;
      return false;
    }
    if (listing.distanceKm != null && listing.distanceKm > RADIUS_KM) {
      diagnostics.droppedByDistance++;
      return false;
    }
    return true;
  });

  diagnostics.totalAfterFilter = filtered.length;
  return { listings: filtered, diagnostics };
}

export async function fetchListings(): Promise<Listing[]> {
  const { listings } = await fetchListingsWithDiagnostics();
  return listings;
}
