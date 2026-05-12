# GoPark Backend (go-park-be-2026)

Backend for the GoPark application, built with NestJS and TypeScript. This service provides admin and business APIs for parking reservations, payments, notifications, and user management.

## Key features

- Authentication and authorization (JWT, roles)
- Parking lots, vehicles, and user management
- Booking, requests, activity tracking
- Payment, wallet, vouchers
- Realtime chat and notifications (Socket.IO)
- Analytics and admin tools

## Tech stack

- NestJS + TypeScript
- TypeORM + PostgreSQL
- Redis + Bull (queue/jobs)
- Socket.IO (WebSocket)
- Supabase SDK
- Email (Nodemailer/Resend)
- QR code, image processing (Sharp), Google Vision

## Folder structure

```
src/
  common/        # enums, dto, middleware
  config/        # database configuration
  modules/       # business modules
  utils/         # filters, interceptors
```

## Install

```bash
npm install
```

Update .env based on your environment (DB, Redis, JWT, Supabase, email, ...).

## Run

```bash
# dev
npm run start:dev

# production
npm run build
npm run start:prod
```

## Common scripts

```bash
npm run lint
npm run test
npm run test:e2e
```

## Notes

- Admin APIs use the /admin/... prefix
- Current modules: auth, booking, chat, notification, parking-lot, payment, request, users, vehicles, voucher, wallet, analytics, activity
