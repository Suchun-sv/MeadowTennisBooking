# Meadows Tennis · Mobile

Phone-first viewer for Meadows Tennis (Edinburgh Leisure) bookings. Reads the
ClubSpark public booking endpoint server-side and renders a list-based UI
that's fast to scan and tap on a phone.

The actual booking still completes on ClubSpark — tapping a free slot opens
the official ClubSpark booking page on the same date so you can sign in and
pay there. (See "Why not full in-app booking?" below.)

## Run locally

```bash
npm install
npm run dev
# open http://localhost:3000
```

Test the API directly:
```bash
curl 'http://localhost:3000/api/slots?date=2026-05-14' | head
```

## Deploy to Vercel

```bash
npx vercel        # link + preview
npx vercel --prod # production
```

No env vars needed.

## How it works

`lib/clubspark.ts` calls two undocumented public endpoints discovered by
capturing the booking page's XHR traffic:

- `GET https://clubspark.net/v0/VenueBooking/EdinburghLeisure/GetSettings`
- `GET https://clubspark.net/v0/VenueBooking/EdinburghLeisure/GetVenueSessions?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&resourceID=&roleId=`

`Sessions` are returned per court with times in **minutes from midnight**
(Europe/London). `Category: 0` means a bookable open slot with `Cost`;
non-zero categories are existing bookings/events overlaid on top. We split
each open band into hourly slots and mark any that overlap an existing
booking as taken.

If ClubSpark changes the response shape, all the parsing lives in
`lib/clubspark.ts` — patch there.

## Why not full in-app booking?

To actually POST a booking we'd need to replicate ClubSpark's OAuth2 implicit
flow (`auth.clubspark.net`), the booking POST against
`prd-solo-api.clubspark.pro`, and the Stripe payment confirm. Those endpoints
only show up in network traffic for an authenticated session, so to
implement them we need a one-time capture of:

1. Sign in via ClubSpark in Chrome.
2. DevTools → Network → XHR.
3. Click a free slot and walk through the booking modal up to "Confirm".
4. Right-click each request hitting `prd-solo-api.clubspark.pro` and "Copy as
   cURL", paste into a follow-up.

With those captures we can add an in-app login + booking POST. Until then
this app is read-only and deep-links to ClubSpark to finish.

## Files

- `app/page.tsx` — mobile UI (list view, date picker, available-only toggle)
- `app/api/slots/route.ts` — server-side proxy with 60s revalidate
- `lib/clubspark.ts` — endpoints, types, and the slot flattening logic
- `public/manifest.json` — PWA manifest so iOS users can "Add to Home Screen"
