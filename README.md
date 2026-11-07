# Hotel Dine · API

REST API for the Hotel Management System ([frontend repository](https://github.com/rudraprotapchakraborty/hotel-management-system-frontend)). Express 5, TypeScript, MongoDB (Mongoose) and Zod.

## Features

- Public menu with search, type, meal time and price filters, sorting and pagination, a most-liked list and an upcoming-dishes list
- Likes are one per member and dish. Liking an upcoming dish needs a paid membership (Silver, Gold or Platinum). Counters are updated atomically
- Reviews: one per member and dish, editable, with rating totals kept on the dish
- Meal requests: ask for a dish to be served, one waiting request per dish, cancel any time. Admins mark requests as served
- Cart with server-side pricing: prices always come from the database, a cart holds one membership plan at a time, and you cannot buy a plan at or below your current tier
- Payments by Stripe (PaymentIntent, verified with Stripe before the order is marked paid, safe to confirm twice) and SSLCommerz sandbox (BDT, validated server to server). A paid plan raises the member's badge, a paid order clears the cart
- Auth: email and password with a six digit email code (HMAC-hashed, 10 minute expiry, 5 attempts, 60 second resend), Google ID-token sign-in, forgot and reset password
- Account: change name and photo, password, email (code sent to the new address), delete account with confirmation
- Roles `USER` and `ADMIN`, memberships (`bronze`, `silver`, `gold`, `platinum`), and an admin area for meals, requests, members and payments
- Shared demo accounts that are locked down: no sign-in or profile changes, no deletion, cannot touch the sample menu, and a demo admin only sees demo data
- Helmet, CORS allow list, rate limits, and the JWT is checked against the database on each request so blocks and role changes apply immediately

## Run it locally

```bash
npm install
cp .env.example .env     # fill in the values
npm run dev              # http://localhost:5000
npm run seed             # sample menu, plans, orders and demo accounts
```

`npm run seed:clear` removes the demo data again. Only accounts flagged as demo, and the reviews, requests, carts and orders that belong to them, are ever touched.

The sample menu lives in `scripts/meals.seed.json`: 25 dishes (21 on the menu and 4 upcoming) with free-licensed photos from Wikipedia. The four plans are in `scripts/plans.seed.json`.

## Environment

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI`, `MONGODB_DB` | Database connection. The app uses its own database (default `hotel_dine`). |
| `JWT_ACCESS_SECRET` | Secret for signing tokens and hashing codes. |
| `CLIENT_URL` | Comma separated list of allowed browser origins. The first one is also where payment redirects send the buyer. |
| `BACKEND_URL` | Public address of this API, used for SSLCommerz callbacks. |
| `GOOGLE_CLIENT_ID` | Google OAuth client id used to verify ID tokens. |
| `STRIPE_SECRET_KEY` | Stripe secret key. Card payments are switched off when it is empty. |
| `SSL_STORE_ID`, `SSL_STORE_PASSWD`, `SSL_USD_TO_BDT` | SSLCommerz sandbox store and the USD to BDT rate used to charge. |
| `SMTP_*`, `MAIL_FROM`, `RESEND_API_KEY` | Email delivery (SMTP first, Resend as fallback). Without either, codes are printed to the console in development. |
| `IMGBB_API_KEY` | Hosts profile photos and dish photos. |

## API overview

All routes live under `/api`. Responses look like `{ "success": true, "data": ... }`.

| Area | Routes |
| --- | --- |
| Meals | `GET /meals` (`q`, `type`, `mealTime`, `minPrice`, `maxPrice`, `sort`, `upcoming`, `page`, `limit`), `/meals/featured`, `/meals/types`, `/meals/:id`, `POST /meals/:id/like`, admin `POST`, `PATCH`, `DELETE /meals/:id` and `POST /meals/:id/publish` |
| Reviews | `GET /reviews/testimonials`, `GET` and `PUT /reviews/meal/:mealId`, `GET /reviews/mine`, `DELETE /reviews/:id` |
| Requests | `POST /requests`, `GET /requests/mine`, `POST /requests/:id/cancel` |
| Cart | `GET /cart`, `POST /cart`, `DELETE /cart/:id` |
| Payments | `GET /payments/config`, `POST /payments/stripe/intent`, `/payments/stripe/confirm`, `/payments/ssl/init`, SSLCommerz callbacks `/payments/ssl/success`, `/fail`, `/cancel`, `GET /payments/mine` |
| Auth | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-otp`, `/auth/login`, `/auth/google`, `/auth/forgot-password`, `/auth/reset-password`, `GET /auth/demo-accounts` |
| Account | `GET/PATCH /users/me/self`, `GET /users/me/methods`, `POST /users/me/password`, `POST` and `PUT /users/me/email`, `DELETE /users/me` |
| Admin | `GET /admin/stats`, `GET /admin/users`, `PATCH /admin/users/:userId` (badge, role, block), `DELETE /admin/users/:userId`, `GET /admin/requests`, `POST /admin/requests/:id/serve`, `GET /admin/payments` |
| Other | `GET /dashboard/summary`, `POST /uploads/image`, `GET /public/stats`, `GET /public/plans`, `GET /health` |

## Deploying

Vercel is supported out of the box: `api/index.ts` is the serverless entry and `vercel.json` rewrites every request to it (the MongoDB connection is cached between invocations). Set the environment variables above in the project settings, including `CLIENT_URL` and `BACKEND_URL`.
