"use client";

import { useEffect, useMemo, useState } from "react";

type Kind = "outdoor" | "grass" | "indoor" | "ballMachine";

const KIND_COLOURS: Record<Kind, { freeBg: string; freeBorder: string; freeText: string; cell: string }> = {
  outdoor:     { freeBg: "bg-accent/15",  freeBorder: "border-accent/50",  freeText: "text-accent",  cell: "bg-accent/70" },
  grass:       { freeBg: "bg-cyan-400/15", freeBorder: "border-cyan-400/50", freeText: "text-cyan-300", cell: "bg-cyan-400/70" },
  indoor:      { freeBg: "bg-violet-400/15", freeBorder: "border-violet-400/50", freeText: "text-violet-300", cell: "bg-violet-400/70" },
  ballMachine: { freeBg: "bg-warn/15",    freeBorder: "border-warn/50",    freeText: "text-warn",    cell: "bg-warn/70" },
};

interface Slot {
  courtId: string;
  courtName: string;
  courtNumber: number;
  kind: Kind;
  displayLabel: string;
  start: number;
  end: number;
  durationMin: number;
  priceTotal: number;
  available: boolean;
  reasonIfTaken?: string;
  deepLink: string;
}
interface ApiResponse {
  venue: { key: string; label: string };
  date: string;
  duration: number;
  minimumInterval: number;
  bookingInterval: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  memberOnlyDurations: number[];
  slots: Slot[];
}

const VENUES = [
  { key: "meadows", label: "Meadows" },
  { key: "craigmillar", label: "Craigmillar" },
  { key: "grange", label: "Grange" },
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
  // Matrix uses atomic (= MinimumInterval). Sheet has its own duration.
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeStart, setActiveStart] = useState<number | null>(null);
  const [sheetDuration, setSheetDuration] = useState(60);
  const [byDuration, setByDuration] = useState<Record<number, ApiResponse>>({});
  const [pending, setPending] = useState<{ link: string; memberOnly: boolean } | null>(null);
  const [weather, setWeather] = useState<Record<number, { tempC: number; precipMm: number; code: number; windKph: number }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWeather(null);
    fetch(`/api/weather?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.hourly) return;
        const map: Record<number, { tempC: number; precipMm: number; code: number; windKph: number }> = {};
        for (const h of j.hourly) map[h.hour] = { tempC: h.tempC, precipMm: h.precipMm, code: h.code, windKph: h.windKph };
        setWeather(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [date]);

  // Guest-allowed durations + any member-only durations the venue config
  // surfaces (rendered in gold; require the user to confirm they're a
  // member before the deep-link is opened).
  const sheetDurations = useMemo(() => {
    if (!data) return [60];
    const step = data.bookingInterval;
    const set = new Set<number>();
    for (let d = data.minDurationMinutes; d <= data.maxDurationMinutes; d += step) set.add(d);
    for (const d of data.memberOnlyDurations) set.add(d);
    return [...set].sort((a, b) => a - b);
  }, [data]);
  const memberOnlySet = useMemo(
    () => new Set(data?.memberOnlyDurations ?? []),
    [data?.memberOnlyDurations],
  );

  // Matrix fetch (atomic = MinimumInterval).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setByDuration({});
    fetch(`/api/slots?venue=${venue}&date=${date}&duration=atomic`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) setErr(j.error || "Failed to load");
        else {
          const resp = j as ApiResponse;
          setData(resp);
          setByDuration({ [resp.duration]: resp });
        }
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [venue, date]);

  // Sheet fetch on demand for its chosen duration.
  useEffect(() => {
    if (activeStart == null) return;
    if (byDuration[sheetDuration]) return;
    let cancelled = false;
    fetch(`/api/slots?venue=${venue}&date=${date}&duration=${sheetDuration}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setByDuration((p) => ({ ...p, [sheetDuration]: j as ApiResponse }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeStart, sheetDuration, venue, date, byDuration]);

  const isToday = date === todayISO();

  // Matrix is always 1h.
  const { times, courts, cell } = useMemo(() => {
    if (!data) return { times: [] as number[], courts: [] as { id: string; name: string; n: number; label: string; kind: Kind }[], cell: new Map<string, Slot>() };
    const cutoff = isToday ? nowMinutes() : -1;
    const tSet = new Set<number>();
    const cMap = new Map<string, { id: string; name: string; n: number; label: string; kind: Kind }>();
    const cell = new Map<string, Slot>();
    for (const s of data.slots) {
      if (s.start < cutoff) continue;
      tSet.add(s.start);
      cMap.set(s.courtId, { id: s.courtId, name: s.courtName, n: s.courtNumber, label: s.displayLabel, kind: s.kind });
      cell.set(`${s.start}|${s.courtId}`, s);
    }
    const times = [...tSet].sort((a, b) => a - b);
    const courts = [...cMap.values()].sort((a, b) => a.n - b.n);
    return { times, courts, cell };
  }, [data, isToday]);

  const sheetData = byDuration[sheetDuration];
  const activeRow = useMemo(() => {
    if (activeStart == null || !sheetData) return null;
    return courts.map((c) => {
      const s = sheetData.slots.find((x) => x.start === activeStart && x.courtId === c.id);
      return s ?? {
        courtId: c.id, courtName: c.name, courtNumber: c.n, kind: c.kind, displayLabel: c.label,
        start: activeStart, end: activeStart + sheetDuration, durationMin: sheetDuration,
        priceTotal: 0, available: false, deepLink: "",
      } as Slot;
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
        <Matrix
          times={times}
          courts={courts}
          cell={cell}
          weather={weather}
          onRowTap={(t) => { setActiveStart(t); setSheetDuration(data?.minDurationMinutes ?? 60); }}
        />
      )}

      {activeStart != null && (
        <Sheet onClose={() => setActiveStart(null)}>
          <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted uppercase tracking-wider">Start</div>
              <div className="text-lg font-semibold tabular-nums">
                {fmt(activeStart)} <span className="text-muted">–</span> {fmt(activeStart + sheetDuration)}
              </div>
            </div>
            <div className="flex items-center bg-bg rounded-full border border-line p-0.5 flex-wrap">
              {sheetDurations.map((d) => {
                const memberOnly = memberOnlySet.has(d);
                const selected = sheetDuration === d;
                let cls: string;
                if (selected && memberOnly) cls = "bg-amber-400 text-black font-semibold";
                else if (selected) cls = "bg-accent text-black font-semibold";
                else if (memberOnly) cls = "text-amber-300";
                else cls = "text-muted";
                return (
                  <button
                    key={d}
                    onClick={() => setSheetDuration(d)}
                    className={`px-2.5 h-8 rounded-full text-sm transition ${cls}`}
                    title={memberOnly ? "Members only" : undefined}
                  >
                    {d % 60 === 0 ? `${d / 60}h` : d === 90 ? "1.5h" : `${d}m`}
                    {memberOnly && <span className="ml-0.5 text-[9px] align-top">★</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {!activeRow ? (
            <div className="px-4 py-6 text-muted text-sm">Loading…</div>
          ) : (
            <div className="px-3 pb-4 grid grid-cols-4 gap-2">
              {activeRow.map((s) => {
                const c = KIND_COLOURS[s.kind];
                const titleLabel =
                  s.kind === "ballMachine" ? "Machine" :
                  s.kind === "grass" ? `Grass ${s.displayLabel.replace(/^G/, "")}` :
                  s.kind === "indoor" ? `Indoor ${s.displayLabel.replace(/^I/, "")}` :
                  `Court ${s.displayLabel}`;
                if (!s.available) {
                  return (
                    <div
                      key={s.courtId}
                      title={s.reasonIfTaken || "Not available"}
                      aria-disabled="true"
                      className="block rounded-xl py-2.5 text-center border bg-line/20 border-line text-muted/50 cursor-not-allowed select-none"
                    >
                      <div className="text-sm font-semibold">{titleLabel}</div>
                      <div className="text-[11px]">—</div>
                    </div>
                  );
                }
                return (
                  <button
                    key={s.courtId}
                    onClick={() => setPending({ link: s.deepLink, memberOnly: memberOnlySet.has(sheetDuration) })}
                    className={`block w-full rounded-xl py-2.5 text-center border ${c.freeBg} ${c.freeBorder} ${c.freeText} active:scale-95`}
                  >
                    <div className="text-sm font-semibold">{titleLabel}</div>
                    <div className="text-[11px] tabular-nums">
                      {s.priceTotal > 0
                        ? `£${s.priceTotal % 1 === 0 ? s.priceTotal : s.priceTotal.toFixed(2)}`
                        : "★"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="px-4 pb-3 text-[11px] text-muted">
            {activeRow ? `${activeRow.filter((s) => s.available).length} of ${activeRow.length} courts available` : ""}
          </div>
        </Sheet>
      )}

      <footer className="fixed bottom-0 inset-x-0 bg-bg/95 backdrop-blur border-t border-line">
        <div className="mx-auto max-w-md flex items-center gap-3 overflow-x-auto whitespace-nowrap px-4 py-2 text-[11px] text-muted">
          {(() => {
            const present = new Set(courts.map((c) => c.kind));
            const items: { k: Kind; label: string }[] = [
              { k: "outdoor", label: "Outdoor" },
              { k: "grass", label: "Grass" },
              { k: "indoor", label: "Indoor" },
              { k: "ballMachine", label: "Machine" },
            ];
            return items.filter((x) => present.has(x.k)).map((x) => (
              <span key={x.k} className="flex items-center gap-1.5">
                <i className={`inline-block h-3 w-3 rounded ${KIND_COLOURS[x.k].cell}`} />
                {x.label}
              </span>
            ));
          })()}
          <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded bg-line/60" /> taken</span>
          <a
            className="ml-auto text-accent font-semibold"
            target="_blank"
            rel="noreferrer"
            href={(() => {
              const map: Record<VenueKey, string> = {
                meadows: `https://clubspark.net/EdinburghLeisure/Booking/BookByDate#?date=${date}&role=guest`,
                craigmillar: `https://www.craigmillarparktennis.co.uk/Booking/BookByDate#?date=${date}&role=member`,
                grange: `https://clubspark.lta.org.uk/GrangeDyvoursLTC/Booking/BookByDate#?date=${date}&role=guest`,
              };
              return map[venue];
            })()}
          >ClubSpark ↗</a>
        </div>
      </footer>

      {pending && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setPending(null)}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative w-full max-w-sm bg-card border border-line rounded-2xl p-5 text-sm space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-warn font-semibold text-base">
              <span>⚠️</span>
              <span>Beta — please double-check / 测试中，请仔细确认</span>
            </div>
            {pending.memberOnly && (
              <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-amber-200 text-[13px] space-y-1">
                <div className="font-semibold">Members only ★ / 仅限会员</div>
                <p>
                  This duration can only be booked by members. Please make
                  sure you are a member of this venue before continuing.
                </p>
                <p>
                  这个时长只有会员才能预订。继续前请确认你自己是会员，否则无法完成预定。
                </p>
              </div>
            )}
            <div className="space-y-2 text-muted leading-relaxed">
              <p>
                This is an unofficial mobile interface to ClubSpark. Slot data
                and price shown here may be out of date or wrong. Always
                verify the court, time and total on the ClubSpark page
                <span className="text-white"> before</span> you pay.
              </p>
              <p>
                这是一个非官方的 ClubSpark 移动端浏览器，时段和价格可能不准。
                <span className="text-white">付款前请务必</span>在 ClubSpark
                页面再确认一次场地、时间和总价。
              </p>
              <p className="text-[12px] text-muted/80 italic">
                Prices shown are guest rates and for reference only — your
                actual price depends on your membership status.<br />
                所显示价格按访客费率计算，仅供参考；实际价格以你的会员身份为准。
              </p>
              <p>
                Bug or feedback? Please open an issue:{" "}
                <a
                  href="https://github.com/Suchun-sv/MeadowTennisBooking/issues"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline"
                >github.com/Suchun-sv/MeadowTennisBooking/issues</a>
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setPending(null)}
                className="flex-1 h-10 rounded-xl border border-line text-muted active:scale-95"
              >Cancel / 取消</button>
              <a
                href={pending.link}
                target="_blank"
                rel="noreferrer"
                onClick={() => setPending(null)}
                className={`flex-1 h-10 rounded-xl font-semibold flex items-center justify-center active:scale-95 ${
                  pending.memberOnly ? "bg-amber-400 text-black" : "bg-accent text-black"
                }`}
              >Continue / 继续 →</a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

interface Tier {
  label: string;
  text: string;
  dot: string;
  severity: number;
}
function rainTier(mm: number): Tier | null {
  if (mm >= 4) return { label: "heavy", text: "text-rose-300 font-semibold", dot: "bg-rose-400", severity: 3 };
  if (mm >= 1) return { label: "mod", text: "text-amber-300", dot: "bg-amber-400", severity: 2 };
  if (mm >= 0.2) return { label: "light", text: "text-sky-300", dot: "bg-sky-400", severity: 1 };
  return null;
}
function windTier(kph: number): Tier | null {
  if (kph >= 40) return { label: "strong", text: "text-fuchsia-300 font-semibold", dot: "bg-fuchsia-400", severity: 3 };
  if (kph >= 25) return { label: "windy", text: "text-indigo-300", dot: "bg-indigo-400", severity: 2 };
  if (kph >= 15) return { label: "breezy", text: "text-slate-300", dot: "bg-slate-400", severity: 1 };
  return null;
}

function Matrix({
  times,
  courts,
  cell,
  weather,
  onRowTap,
}: {
  times: number[];
  courts: { id: string; name: string; n: number; label: string; kind: Kind }[];
  cell: Map<string, Slot>;
  weather: Record<number, { tempC: number; precipMm: number; code: number; windKph: number }> | null;
  onRowTap: (t: number) => void;
}) {
  if (times.length === 0)
    return <div className="px-4 py-12 text-center text-muted text-sm">No bookable slots remaining.</div>;
  // 56px time column (wider to fit the inline weather glyph)
  const cols = `56px repeat(${courts.length}, minmax(0, 1fr))`;
  return (
    <div className="px-2 py-2">
      <div className="rounded-2xl border border-line bg-card overflow-hidden">
        {/* header */}
        <div className="grid bg-card border-b border-line text-[11px] text-muted font-medium" style={{ gridTemplateColumns: cols }}>
          <div className="py-2 text-center text-[10px] uppercase tracking-wider">time · °C</div>
          {courts.map((c) => (
            <div key={c.id} className={`py-2 text-center tabular-nums font-semibold ${KIND_COLOURS[c.kind].freeText}`}>{c.label}</div>
          ))}
        </div>
        {/* rows */}
        {times.map((t) => {
          const rowSlots = courts.map((c) => cell.get(`${t}|${c.id}`));
          const freeCount = rowSlots.filter((s) => s?.available).length;
          const anyFree = freeCount > 0;
          const h = Math.floor(t / 60);
          const w = weather?.[h];
          const rain = w ? rainTier(w.precipMm) : null;
          const wind = w ? windTier(w.windKph) : null;
          return (
            <button
              key={t}
              onClick={() => anyFree && onRowTap(t)}
              disabled={!anyFree}
              className={`relative grid w-full text-left border-b border-line/60 last:border-b-0 ${
                anyFree ? "active:bg-line/30" : "opacity-60 cursor-not-allowed"
              }`}
              style={{ gridTemplateColumns: cols }}
            >
              {/* severity stripe on the left edge — top half rain, bottom half wind */}
              {(rain || wind) && (
                <span className="absolute left-0 top-0 bottom-0 w-1 flex flex-col overflow-hidden">
                  <span className={`flex-1 ${rain ? rain.dot : "bg-transparent"} ${rain && rain.severity >= 3 ? "animate-pulse" : ""}`} />
                  <span className={`flex-1 ${wind ? wind.dot : "bg-transparent"} ${wind && wind.severity >= 3 ? "animate-pulse" : ""}`} />
                </span>
              )}
              <div className="py-1.5 text-center text-[11px] text-muted tabular-nums border-r border-line/60 flex flex-col items-center justify-center leading-tight">
                <span>{fmt(t)}</span>
                {w && (
                  <>
                    <span className="text-[9px] text-muted/80">{Math.round(w.tempC)}°</span>
                    {rain && (
                      <span className={`text-[9px] ${rain.text}`} title={`${w.precipMm.toFixed(1)} mm/h`}>
                        🌧{rain.label}
                      </span>
                    )}
                    {wind && (
                      <span className={`text-[9px] ${wind.text}`} title={`${Math.round(w.windKph)} km/h`}>
                        🌬{wind.label}
                      </span>
                    )}
                  </>
                )}
              </div>
              {rowSlots.map((s, i) => {
                const cls = !s
                  ? "bg-transparent"
                  : s.available
                  ? KIND_COLOURS[s.kind].cell
                  : "bg-line/60";
                return (
                  <div key={i} className="p-0.5">
                    <div
                      title={s?.reasonIfTaken}
                      className={`w-full aspect-square rounded ${cls}`}
                    />
                  </div>
                );
              })}
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
