// Venue-agnostic ClubSpark client. ClubSpark serves multiple venues from
// the same code: some on `clubspark.net/{slug}/...` (subdirectory mode)
// and some on their own domain (`VenueMode = 'domain'`). Both expose:
//   GET {host}/v0/VenueBooking/{slug}/GetSettings
//   GET {host}/v0/VenueBooking/{slug}/GetVenueSessions?...
// and the booking page deep-link:
//   GET {host}/{venuePathPrefix}Booking/Book?ResourceID=&Date=&SessionID=
//        &StartTime=&EndTime=&Category=&SubCategory=&VenueID=&ResourceGroupID=

export type VenueKey = "meadows" | "craigmillar" | "grange";

interface VenueConfig {
  key: VenueKey;
  label: string;
  base: string;
  apiSlug: string;
  apiOrigin: string;
  venueId: string;
  defaultRole: "guest" | "member";
  // Extra durations (in minutes) only allowed for members. Public
  // GetSettings only exposes the Guest role, so member-only options have
  // to be configured here. Surfaced in UI with a distinct colour.
  memberOnlyDurations?: number[];
}

export const VENUES: Record<VenueKey, VenueConfig> = {
  meadows: {
    key: "meadows",
    label: "Meadows",
    base: "https://clubspark.net/EdinburghLeisure",
    apiSlug: "EdinburghLeisure",
    apiOrigin: "https://clubspark.net",
    venueId: "fe88d453-bf0f-44b7-82a5-d9cbb05353b1",
    defaultRole: "guest",
  },
  craigmillar: {
    key: "craigmillar",
    label: "Craigmillar",
    base: "https://www.craigmillarparktennis.co.uk",
    apiSlug: "www_craigmillarparktennis_co_uk",
    apiOrigin: "https://www.craigmillarparktennis.co.uk",
    venueId: "f30b1200-9806-4aa0-812a-8698b2ea079a",
    defaultRole: "member",
  },
  grange: {
    key: "grange",
    label: "Grange",
    base: "https://clubspark.lta.org.uk/GrangeDyvoursLTC",
    apiSlug: "GrangeDyvoursLTC",
    apiOrigin: "https://clubspark.lta.org.uk",
    venueId: "93cdcb51-6c6d-4ab5-9788-41a5045ab20c",
    defaultRole: "guest",
    memberOnlyDurations: [90], // members can do 1.5h, guests cannot
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
  Category?: number; // 1=Tennis, 5=Ball machine, 13=Padel, 14=Pickleball, ...
  Days: { Date: string; Sessions: RawSession[] }[];
}

// Resource categories we want to surface.
const PADEL = 13;
const BALL_MACHINE = 5;
// Visual kind. "outdoor" is the default green; grass/indoor/ballMachine each
// get their own colour in the UI.
type Kind = "outdoor" | "grass" | "indoor" | "ballMachine";

function kindOf(cat: number | undefined, name: string): Kind | null {
  if (cat === PADEL) return null; // hide
  if (cat === BALL_MACHINE) return "ballMachine";
  if (/grass/i.test(name)) return "grass";
  if (/indoor/i.test(name)) return "indoor";
  return "outdoor";
}

// Short, mobile-friendly label parsed from the Resource Name.
function shortLabel(name: string, kind: Kind, fallback: number): string {
  if (kind === "ballMachine") return "M";
  const m = name.match(/(\d+)/);
  const num = m ? m[1] : String(fallback);
  if (kind === "grass") return `G${num}`;
  if (kind === "indoor") return `I${num}`;
  return num;
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

export interface VenueSettings {
  DefaultInterval: number;
  Roles: { Name: string; MinimumBookingIntervals: number; MaximumBookingIntervals: number; CanBook: boolean }[];
}

export async function fetchVenueSettings(v: VenueConfig): Promise<VenueSettings> {
  const url = `${v.apiOrigin}/v0/VenueBooking/${v.apiSlug}/GetSettings`;
  const res = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*", "User-Agent": "clubspark-mobile/0.2" },
    next: { revalidate: 600 },
  });
  if (!res.ok) throw new Error(`ClubSpark settings ${res.status}`);
  return res.json();
}

// Pick the role we display by default (guest unless venue overrides).
export function pickRole(settings: VenueSettings, v: VenueConfig) {
  const wantName = v.defaultRole === "member" ? "Member" : "Guest";
  return (
    settings.Roles.find((r) => r.Name.toLowerCase() === wantName.toLowerCase()) ??
    settings.Roles[0]
  );
}

export interface Slot {
  courtId: string;
  courtName: string;
  courtNumber: number;
  kind: Kind;
  displayLabel: string;
  start: number;
  end: number;
  durationMin: number;
  // Total cost for this exact (start, duration) on this court, in the
  // venue's currency. Already multiplied through; UI does not need to
  // know the per-interval rate.
  priceTotal: number;
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

  // Filter out hidden categories (e.g. Padel); derive short label from name.
  const surfaced = data.Resources
    .map((r) => ({ r, kind: kindOf(r.Category, r.Name) }))
    .filter((x): x is { r: RawResource; kind: Kind } => x.kind !== null);
  const meta = new Map<string, { kind: Kind; idx: number; label: string }>();
  surfaced.forEach(({ r, kind }, idx) => {
    meta.set(r.ID, { kind, idx, label: shortLabel(r.Name, kind, idx + 1) });
  });

  for (const { r: resource } of surfaced) {
    const m = meta.get(resource.ID)!;
    const day = resource.Days[0];
    if (!day) continue;
    const opens = day.Sessions.filter((s) => s.Category === 0);
    const blocks = day.Sessions.filter((s) => s.Category !== 0);
    for (const open of opens) {
      // ClubSpark Cost is per-`Interval`. A booking covering `duration`
      // minutes spans (duration / Interval) intervals at this rate.
      const interval = open.Interval || data.MinimumInterval || 60;
      const costPerInterval = open.Cost ?? open.CostFrom ?? 0;
      const intervalsInSlot = Math.max(1, Math.round(duration / interval));
      const priceTotal = +(costPerInterval * intervalsInSlot).toFixed(2);
      for (let t = open.StartTime; t + duration <= open.EndTime; t += STEP) {
        const conflict = blocks.find((b) => t < b.EndTime && t + duration > b.StartTime);
        const available = !conflict;
        slots.push({
          courtId: resource.ID,
          courtName: resource.Name,
          courtNumber: m.idx,
          kind: m.kind,
          displayLabel: m.label,
          start: t,
          end: t + duration,
          durationMin: duration,
          priceTotal,
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
