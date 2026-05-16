# GoPark Chatbot Booking Flow

## Goal

The chatbot should behave like a natural assistant, not a rigid form. When a user wants to book parking, collect the minimum required booking context before redirecting to the booking page.

## Required Context

- Parking lot: a lot id resolved from the spoken or typed lot name.
- Time range: start and end time in `YYYY-MM-DDTHH:mm`.
- Vehicle: user's vehicle plate number, because the frontend booking form selects vehicles by plate number.
- Payment method: defaults to `vnpay` if the user does not specify one.

## Conversation Rules

- If the user says "toi muon dat bai My Khe", resolve the lot first, then ask for missing time and vehicle.
- If the user says "ngay mai tu 8h den 10h xe 1", merge that into the pending booking context.
- If vehicle is missing, suggest registered vehicles as "Xe 1 la bien so ...; Xe 2 la bien so ..." so the user does not need to remember or speak the full plate number.
- Accept short follow-up answers like "xe 1", "xe 2", or a direct plate number.
- If parking lot name is missing or hard to remember, suggest short numbered choices like "Bai 1 la ...; Bai 2 la ...". Accept "bai 1" or "bai 2".
- If time is missing, suggest natural examples such as "hom nay tu 8h den 10h", "ngay mai tu 7h30 den 9h", or "luc 14h trong 2 gio".
- If payment method is unclear, suggest "thanh toan 1 la VNPAY; thanh toan 2 la vi GoPark; thanh toan 3 la tien mat". Default to VNPAY if the user skips it.
- If all required fields are available, return `action: redirect` with `/users/myBooking/:parkingLotId?start=...&end=...&vehicle=...&payment=...`.
- Do not redirect while lot, time, or vehicle is missing.
- Reuse previous messages and pending context to avoid asking the same question again.

## Examples

User: "toi muon dat bai My Khe"
Assistant: "Minh da ghi nhan bai My Khe. Ban cho minh them thoi gian vao/ra va xe."

User: "ngay mai tu 8h den 10h, xe 1"
Assistant: return redirect to the booking page with the resolved lot, time range, vehicle plate, and payment method.
