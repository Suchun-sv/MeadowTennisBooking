import { NextRequest, NextResponse } from "next/server";

// Edinburgh — all three venues are within a few km. Single forecast is fine.
const LAT = 55.9533;
const LON = -3.1883;

export const revalidate = 600;

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&hourly=temperature_2m,precipitation,weathercode,wind_speed_10m` +
    `&timezone=Europe%2FLondon&start_date=${date}&end_date=${date}`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) return NextResponse.json({ error: "upstream" }, { status: 502 });
  const j = await res.json();
  const hourly = (j.hourly?.time ?? []).map((t: string, i: number) => ({
    hour: Number(t.split("T")[1].split(":")[0]),
    tempC: j.hourly.temperature_2m[i],
    precipMm: j.hourly.precipitation[i],
    windKph: j.hourly.wind_speed_10m[i],
    code: j.hourly.weathercode[i],
  }));
  return NextResponse.json({ date, hourly });
}
