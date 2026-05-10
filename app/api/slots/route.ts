import { NextRequest, NextResponse } from "next/server";
import { fetchVenueSessions, flattenSlots, VENUES, VenueKey } from "@/lib/clubspark";

export const revalidate = 60;
const ALLOWED_DURATIONS = [30, 60, 90, 120, 180];

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  const venueKey = (req.nextUrl.searchParams.get("venue") || "meadows") as VenueKey;
  const durationParam = req.nextUrl.searchParams.get("duration"); // may be "atomic"
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  const venue = VENUES[venueKey];
  if (!venue) return NextResponse.json({ error: "unknown venue" }, { status: 400 });
  try {
    const raw = await fetchVenueSessions(venue, date);
    let duration: number;
    if (!durationParam || durationParam === "atomic") {
      duration = raw.MinimumInterval || 60;
    } else {
      const n = Number(durationParam);
      duration = ALLOWED_DURATIONS.includes(n) ? n : 60;
    }
    const slots = flattenSlots(venue, raw, date, duration);
    return NextResponse.json({
      venue: { key: venue.key, label: venue.label },
      date,
      duration,
      minimumInterval: raw.MinimumInterval,
      slots,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "upstream error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
