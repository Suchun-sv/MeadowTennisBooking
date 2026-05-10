"use client";

import { useEffect, useMemo, useState } from "react";

interface Slot {
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
interface ApiResponse {
  venue: { key: string; label: string };
  date: string;
  duration: number;
  minimumInterval: number;
  slots: Slot[];
}

const DURATIONS = [60, 120, 180];
const VENUES = [
  { key: "meadows", label: "Meadows" },
  { key: "craigmillar", label: "Craigmillar" },
] as const;
type VenueKey = (typeof VENUES)[number]["key"];

const fmt = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const prettyDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

const nowMinutes = () => {
  const d = new Date();
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

export default function Page() {
  const [venue, setVenue] = useState<VenueKey>("meadows");
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeStart, setActiveStart] = useState<number | null>(null);
  const [sheetDuration, setSheetDuration] = useState(60);
  const [byDuration, setByDuration] = useState<Record<number, ApiResponse>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setByDuration({});
    fetch(`/api/slots?venue=${venue}&date=${date}&duration=60`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) setErr(j.error || "Failed to load");
        else {
          setData(j as ApiResponse);
          setByDuration({ 60: j as ApiResponse });
        }
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [venue, date]);

  useEffect(() => {
    if (activeStart == null) return;
    if (byDuration[sheetDuration]) return;
    let cancelled = false;
    fetch(`/api/slots?venue=${venue}&date=${date}&duration=${sheetDuration}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setByDuration((prev) => ({ ...prev, [sheetDuration]: j as ApiResponse })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeStart, sheetDuration, venue, date, byDuration]);

  const isToday = date === todayISO();

  // Matrix is always 1h.
  const { times, courts, cell } = useMemo(() => {
    if (!data) return { times: [] as number[], courts: [] as { id: string; name: string; n: number }[], cell: new Map<string, Slot>() };
    const cutoff = isToday ? nowMinutes() : -1;
    const tSet = new Set<number>();
    const cMap = new Map<string, { id: string; name: string; n: number }>();
    const cell = new Map<string, Slot>();
    for (const s of data.slots) {
      if (s.start < cutoff) continue;
      tSet.add(s.start);
      cMap.set(s.courtId, { id: s.courtId, name: s.courtName, n: s.courtNumber });
      cell.set(`${s.start}|${s.courtId}`, s);
    }
    const times = [...tSet].sort((a, b) => a - b);
    const courts = [...cMap.values()].sort((a, b) => a.n - b.n);
    return { times, courts, cell };
  }, [data, isToday]);

  // Sheet content: row of slots at activeStart for the chosen sheetDuration.
  const sheetData = byDuration[sheetDuration];
  const activeRow = useMemo(() => {
    if (activeStart == null || !sheetData) return null;
    return courts.map((c) => {
      const s = sheetData.slots.find((x) => x.start === activeStart && x.courtId === c.id);
      return s ?? { courtId: c.id, courtName: c.name, courtNumber: c.n, start: activeStart, end: activeStart + sheetDuration, durationMin: sheetDuration, pricePerHour: 0, available: false, deepLink: "" } as Slot;
    });
  }, [activeStart, sheetData, sheetDuration, courts]);

  return (
    <main className="mx-auto max-w-md pb-24">
      <header className="sticky top-0 z-20 backdrop-blur bg-bg/85 border-b border-line">
        <div className="px-4 pt-3 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center bg-card rounded-full border border-line p-0.5">
              {VENUES.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setVenue(v.key)}
                  className={`px-3 h-8 rounded-full text-sm transition ${
                    venue === v.key ? "bg-accent text-black font-semibold" : "text-muted"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="bg-card border border-line rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div className="text-lg font-semibold">
            {prettyDate(date)}
            {isToday && <span className="text-accent text-xs ml-2">today</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDate(addDays(date, -1))} className="h-9 w-9 rounded-full bg-card border border-line text-lg active:scale-95">‹</button>
            <button onClick={() => setDate(todayISO())} className={`flex-1 h-9 rounded-full border text-sm ${isToday ? "border-accent text-accent" : "border-line text-muted"}`}>Today</button>
            <button onClick={() => setDate(addDays(date, 1))} className="h-9 w-9 rounded-full bg-card border border-line text-lg active:scale-95">›</button>
          </div>
        </div>
      </header>

      {loading && <div className="px-4 py-8 text-muted text-sm">Loading…</div>}
      {err && <div className="m-4 p-3 rounded bg-warn/10 border border-warn/40 text-warn text-sm">{err}</div>}

      {!loading && !err && data && (
        <Matrix times={times} courts={courts} cell={cell} onRowTap={(t) => { setActiveStart(t); setSheetDuration(60); }} />
      )}

      {activeStart != null && (
        <Sheet onClose={() => setActiveStart(null)}>
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted uppercase tracking-wider">Start</div>
              <div className="text-lg font-semibold tabular-nums">
                {fmt(activeStart)} <span className="text-muted">–</span> {fmt(activeStart + sheetDuration)}
              </div>
            </div>
            <div className="flex items-center bg-bg rounded-full border border-line p-0.5">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setSheetDuration(d)}
                  className={`px-3 h-8 rounded-full text-sm transition ${
                    sheetDuration === d ? "bg-accent text-black font-semibold" : "text-muted"
                  }`}
                >
                  {d / 60}h
                </button>
              ))}
            </div>
          </div>

          {!activeRow ? (
            <div className="px-4 py-6 text-muted text-sm">Loading…</div>
          ) : (
            <div className="px-3 pb-4 grid grid-cols-4 gap-2">
              {activeRow.map((s) => (
                <a
                  key={s.courtId}
                  href={s.available ? s.deepLink : undefined}
                  target="_blank"
                  rel="noreferrer"
                  title={s.reasonIfTaken}
                  className={`block rounded-xl py-2.5 text-center border ${
                    s.available
                      ? "bg-accent/15 border-accent/50 text-accent active:scale-95 active:bg-accent/25"
                      : "bg-line/20 border-line text-muted/50"
                  }`}
                >
                  <div className="text-sm font-semibold">{s.courtName.replace("Court ", "C")}</div>
                  <div className="text-[11px] tabular-nums">
                    {s.available ? `£${Math.round((s.pricePerHour * sheetDuration) / 60)}` : "—"}
                  </div>
                </a>
              ))}
            </div>
          )}
          <div className="px-4 pb-3 text-[11px] text-muted">
            {activeRow ? `${activeRow.filter((s) => s.available).length} of ${activeRow.length} courts available` : ""}
          </div>
        </Sheet>
      )}

      <footer className="fixed bottom-0 inset-x-0 bg-bg/95 backdrop-blur border-t border-line">
        <div className="mx-auto max-w-md flex items-center justify-between px-4 py-2 text-xs text-muted">
          <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded bg-accent/30 border border-accent/50" /> free</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded bg-line/40 border border-line" /> taken</span>
          <a
            href={
              venue === "meadows"
                ? `https://clubspark.net/EdinburghLeisure/Booking/BookByDate#?date=${date}&role=guest`
                : `https://www.craigmillarparktennis.co.uk/Booking/BookByDate#?date=${date}&role=member`
            }
            target="_blank"
            rel="noreferrer"
            className="text-accent font-semibold"
          >ClubSpark ↗</a>
        </div>
      </footer>
    </main>
  );
}

function Matrix({
  times,
  courts,
  cell,
  onRowTap,
}: {
  times: number[];
  courts: { id: string; name: string; n: number }[];
  cell: Map<string, Slot>;
  onRowTap: (t: number) => void;
}) {
  if (times.length === 0)
    return <div className="px-4 py-12 text-center text-muted text-sm">No bookable slots remaining.</div>;
  // Build a CSS grid: time column (40px) + N courts (1fr each)
  const cols = `40px repeat(${courts.length}, minmax(0, 1fr))`;
  return (
    <div className="px-2 py-2">
      <div className="rounded-2xl border border-line bg-card overflow-hidden">
        {/* header */}
        <div className="grid bg-card border-b border-line text-[11px] text-muted font-medium" style={{ gridTemplateColumns: cols }}>
          <div className="py-2 text-center text-[10px] uppercase tracking-wider">time</div>
          {courts.map((c) => (
            <div key={c.id} className="py-2 text-center tabular-nums">{c.n + 1}</div>
          ))}
        </div>
        {/* rows */}
        {times.map((t) => {
          const rowSlots = courts.map((c) => cell.get(`${t}|${c.id}`));
          const freeCount = rowSlots.filter((s) => s?.available).length;
          return (
            <button
              key={t}
              onClick={() => onRowTap(t)}
              className="grid w-full text-left border-b border-line/60 last:border-b-0 active:bg-line/30"
              style={{ gridTemplateColumns: cols }}
            >
              <div className="py-1.5 text-center text-[11px] text-muted tabular-nums border-r border-line/60 flex items-center justify-center">
                {fmt(t)}
              </div>
              {rowSlots.map((s, i) => (
                <div key={i} className="p-0.5">
                  <div
                    title={s?.reasonIfTaken}
                    className={`w-full aspect-square rounded ${
                      !s
                        ? "bg-transparent"
                        : s.available
                        ? "bg-accent/70"
                        : "bg-line/60"
                    }`}
                  />
                </div>
              ))}
            </button>
          );
        })}
      </div>
      <div className="px-1 pt-2 text-[10px] text-muted text-center">
        Tap a row to see prices & book
      </div>
    </div>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full mx-auto max-w-md bg-card border-t border-line rounded-t-2xl pb-[env(safe-area-inset-bottom)] animate-[slideUp_.18s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2"><div className="h-1 w-10 rounded-full bg-line" /></div>
        {children}
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%);} to { transform: translateY(0);} }`}</style>
    </div>
  );
}
