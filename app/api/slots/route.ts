import { NextRequest, NextResponse } from "next/server";
import { fetchVenueSessions, fetchVenueSettings, flattenSlots, pickRole, VENUES, VenueKey } from "@/lib/clubspark";

export const revalidate = 60;
const ALLOWED_DURATIONS = [30, 60, 90, 120, 150, 180];

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  const venueKey = (req.nextUrl.searchParams.get("venue") || "meadows") as VenueKey;
  const durationParam = req.nextUrl.searchParams.get("duration"); // may be "atomic"
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  const venue = VENUES[venueKey];
  if (!venue) return NextResponse.json({ error: "unknown venue" }, { status: 400 });
  try {
    const [raw, settings] = await Promise.all([
      fetchVenueSessions(venue, date),
      fetchVenueSettings(venue),
    ]);
    const role = pickRole(settings, venue);
    const interval = settings.DefaultInterval || raw.MinimumInterval || 60;
    const minDuration = role.MinimumBookingIntervals * interval;
    const maxDuration = role.MaximumBookingIntervals * interval;

    let duration: number;
    if (!durationParam || durationParam === "atomic") {
      duration = raw.MinimumInterval || 60;
    } else {
      const n = Number(durationParam);
      duration = ALLOWED_DURATIONS.includes(n) ? n : minDuration;
    }
    const slots = flattenSlots(venue, raw, date, duration);
    // If the venue is members-only across the board, mark every offered
    // duration as member-only so the UI styles them all in gold.
    const memberOnlyDurations = new Set<number>(venue.memberOnlyDurations ?? []);
    if (venue.allDurationsMemberOnly) {
      for (let d = minDuration; d <= maxDuration; d += interval) memberOnlyDurations.add(d);
    }
    return NextResponse.json({
      venue: { key: venue.key, label: venue.label },
      date,
      duration,
      minimumInterval: raw.MinimumInterval,
      bookingInterval: interval,
      minDurationMinutes: minDuration,
      maxDurationMinutes: maxDuration,
      memberOnlyDurations: [...memberOnlyDurations].sort((a, b) => a - b),
      slots,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "upstream error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
