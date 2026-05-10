import { NextRequest, NextResponse } from "next/server";
import { fetchVenueSessions, flattenSlots } from "@/lib/clubspark";

export const revalidate = 60;

const ALLOWED_DURATIONS = [60, 120, 180];

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  const durationRaw = Number(req.nextUrl.searchParams.get("duration") ?? 60);
  const duration = ALLOWED_DURATIONS.includes(durationRaw) ? durationRaw : 60;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  try {
    const raw = await fetchVenueSessions(date);
    const slots = flattenSlots(raw, date, duration);
    return NextResponse.json({ date, duration, slots, courts: raw.Resources.map((r) => ({ id: r.ID, name: r.Name, number: r.Number })) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "upstream error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
