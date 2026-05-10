// Venue-agnostic ClubSpark client. ClubSpark serves multiple venues from
// the same code: some on `clubspark.net/{slug}/...` (subdirectory mode)
// and some on their own domain (`VenueMode = 'domain'`). Both expose:
//   GET {host}/v0/VenueBooking/{slug}/GetSettings
//   GET {host}/v0/VenueBooking/{slug}/GetVenueSessions?...
// and the booking page deep-link:
//   GET {host}/{venuePathPrefix}Booking/Book?ResourceID=&Date=&SessionID=
//        &StartTime=&EndTime=&Category=&SubCategory=&VenueID=&ResourceGroupID=

export type VenueKey = "meadows" | "craigmillar";

interface VenueConfig {
  key: VenueKey;
  label: string;
  // Base URL incl. subdirectory if any (no trailing slash).
  // Booking deep link uses `${base}/Booking/Book?...` and the role/date listing
  // uses `${base}/Booking/BookByDate#?date=...&role=guest`.
  base: string;
  // Slug used in /v0/VenueBooking/{slug}/...
  apiSlug: string;
  // Origin for the API call. Usually same as base origin.
  apiOrigin: string;
  venueId: string;
  defaultRole: "guest" | "member";
}

export const VENUES: Record<VenueKey, VenueConfig> = {
  meadows: {
    key: "meadows",
    label: "Meadows Tennis",
    base: "https://clubspark.net/EdinburghLeisure",
    apiSlug: "EdinburghLeisure",
    apiOrigin: "https://clubspark.net",
    venueId: "fe88d453-bf0f-44b7-82a5-d9cbb05353b1",
    defaultRole: "guest",
  },
  craigmillar: {
    key: "craigmillar",
    label: "Craigmillar Park",
    base: "https://www.craigmillarparktennis.co.uk",
    apiSlug: "www_craigmillarparktennis_co_uk",
    apiOrigin: "https://www.craigmillarparktennis.co.uk",
    venueId: "f30b1200-9806-4aa0-812a-8698b2ea079a",
    defaultRole: "member",
  },
};

export interface RawSession {
  ID: string;
  Category: number;
  SubCategory: number;
  Name: string;
  Colour?: string;
  StartTime: number;
  EndTime: number;
  Interval: number;
  Capacity: number;
  Cost?: number;
  CostFrom?: number;
}
export interface RawResource {
  ID: string;
  ResourceGroupID: string;
  Name: string;
  Number: number;
  Days: { Date: string; Sessions: RawSession[] }[];
}
export interface VenueSessionsResponse {
  TimeZone: string;
  EarliestStartTime: number;
  LatestEndTime: number;
  MinimumInterval: number;
  ResourceGroups: { ID: string; Name: string }[];
  Resources: RawResource[];
}

export async function fetchVenueSessions(v: VenueConfig, date: string): Promise<VenueSessionsResponse> {
  const url = `${v.apiOrigin}/v0/VenueBooking/${v.apiSlug}/GetVenueSessions?resourceID=&startDate=${date}&endDate=${date}&roleId=&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*", "User-Agent": "clubspark-mobile/0.2" },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`ClubSpark ${res.status}`);
  return res.json();
}

export interface Slot {
  courtId: string;
  courtName: string;
  courtNumber: number;
  start: number;
  end: number;
  durationMin: number;
  pricePerHour: number;
  available: boolean;
  reasonIfTaken?: string;
  deepLink: string;
}

export function listingUrl(v: VenueConfig, date: string): string {
  return `${v.base}/Booking/BookByDate#?date=${date}&role=${v.defaultRole}`;
}

function bookUrl(v: VenueConfig, p: {
  resourceId: string;
  resourceGroupId: string;
  sessionId: string;
  date: string;
  startTime: number;
  endTime: number;
  category: number;
  subCategory: number;
}): string {
  const q = new URLSearchParams({
    ResourceID: p.resourceId,
    Date: p.date,
    SessionID: p.sessionId,
    StartTime: String(p.startTime),
    EndTime: String(p.endTime),
    Category: String(p.category),
    SubCategory: String(p.subCategory),
    VenueID: v.venueId,
    ResourceGroupID: p.resourceGroupId,
  });
  return `${v.base}/Booking/Book?${q.toString()}`;
}

export function flattenSlots(
  v: VenueConfig,
  data: VenueSessionsResponse,
  date: string,
  duration: number,
): Slot[] {
  const STEP = data.MinimumInterval || 60;
  const slots: Slot[] = [];
  for (const resource of data.Resources) {
    const day = resource.Days[0];
    if (!day) continue;
    const opens = day.Sessions.filter((s) => s.Category === 0);
    const blocks = day.Sessions.filter((s) => s.Category !== 0);
    for (const open of opens) {
      const pricePerHour = open.Cost ?? open.CostFrom ?? 0;
      for (let t = open.StartTime; t + duration <= open.EndTime; t += STEP) {
        const conflict = blocks.find((b) => t < b.EndTime && t + duration > b.StartTime);
        const available = !conflict;
        slots.push({
          courtId: resource.ID,
          courtName: resource.Name,
          courtNumber: resource.Number,
          start: t,
          end: t + duration,
          durationMin: duration,
          pricePerHour,
          available,
          reasonIfTaken: conflict?.Name,
          deepLink: available
            ? bookUrl(v, {
                resourceId: resource.ID,
                resourceGroupId: resource.ResourceGroupID,
                sessionId: open.ID,
                date,
                startTime: t,
                endTime: t + duration,
                category: open.Category,
                subCategory: open.SubCategory,
              })
            : listingUrl(v, date),
        });
      }
    }
  }
  slots.sort((a, b) => a.start - b.start || a.courtNumber - b.courtNumber);
  return slots;
}

export function fmtTime(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
