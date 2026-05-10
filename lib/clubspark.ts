// All ClubSpark-specific quirks live in this file. If they change anything,
// patch here.
//
// Discovered by capturing XHR traffic on
// https://clubspark.net/EdinburghLeisure/Booking/BookByDate :
//   GET /v0/VenueBooking/EdinburghLeisure/GetSettings
//   GET /v0/VenueBooking/EdinburghLeisure/GetVenueSessions
//        ?resourceID=&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&roleId=
//
// Times are minutes from midnight in Europe/London. Categories observed:
//   0    : open bookable slot (has Cost, Capacity:1)
//   1000 : existing booking (private/recurring)
//   3000 : match / event

const VENUE = "EdinburghLeisure";
const BASE = `https://clubspark.net/v0/VenueBooking/${VENUE}`;

export interface RawSession {
  ID: string;
  Category: number;
  SubCategory: number;
  Name: string;
  Colour?: string;
  StartTime: number; // minutes from midnight
  EndTime: number;
  Interval: number;
  Capacity: number;
  Cost?: number;
  CostFrom?: number;
  CourtCost?: number;
}

export interface RawResource {
  ID: string;
  ResourceGroupID: string;
  Name: string;
  Number: number;
  Lighting: number;
  Surface: number;
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

const VENUE_ID = "fe88d453-bf0f-44b7-82a5-d9cbb05353b1"; // Meadows Tennis (from GetSettings)

function bookUrl(p: {
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
    VenueID: VENUE_ID,
    ResourceGroupID: p.resourceGroupId,
  });
  return `https://clubspark.net/${VENUE}/Booking/Book?${q.toString()}`;
}

export async function fetchVenueSessions(date: string): Promise<VenueSessionsResponse> {
  const url = `${BASE}/GetVenueSessions?resourceID=&startDate=${date}&endDate=${date}&roleId=&_=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "clubspark-mobile/0.1 (+https://github.com/)",
    },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`ClubSpark ${res.status}`);
  return res.json();
}

export interface Slot {
  courtId: string;
  courtName: string;
  courtNumber: number;
  start: number; // minutes
  end: number;
  durationMin: number;
  pricePerHour: number;
  available: boolean;
  reasonIfTaken?: string;
  deepLink: string;
}

export function deepLinkFor(date: string): string {
  return `https://clubspark.net/${VENUE}/Booking/BookByDate#?date=${date}&role=guest`;
}

// For each duration (in minutes), enumerate every (court, startTime) where
// a contiguous block of `duration` fits inside one open Session and
// doesn't overlap any non-open session. Step by 60 minutes (ClubSpark's
// MinimumInterval for this venue).
export function flattenSlots(
  data: VenueSessionsResponse,
  date: string,
  duration: number,
): Slot[] {
  const STEP = 60;
  const slots: Slot[] = [];
  for (const resource of data.Resources) {
    const day = resource.Days[0];
    if (!day) continue;

    const opens = day.Sessions.filter((s) => s.Category === 0);
    const blocks = day.Sessions.filter((s) => s.Category !== 0);

    for (const open of opens) {
      const totalCost = open.Cost ?? open.CostFrom ?? 0; // £/hour for this band
      for (let t = open.StartTime; t + duration <= open.EndTime; t += STEP) {
        const conflict = blocks.find(
          (b) => t < b.EndTime && t + duration > b.StartTime,
        );
        const available = !conflict;
        slots.push({
          courtId: resource.ID,
          courtName: resource.Name,
          courtNumber: resource.Number,
          start: t,
          end: t + duration,
          durationMin: duration,
          pricePerHour: totalCost,
          available,
          reasonIfTaken: conflict?.Name,
          deepLink: available
            ? bookUrl({
                resourceId: resource.ID,
                resourceGroupId: resource.ResourceGroupID,
                sessionId: open.ID,
                date,
                startTime: t,
                endTime: t + duration,
                category: open.Category,
                subCategory: open.SubCategory,
              })
            : deepLinkFor(date),
        });
      }
    }
  }
  slots.sort((a, b) => a.start - b.start || a.courtNumber - b.courtNumber);
  return slots;
}

export function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
