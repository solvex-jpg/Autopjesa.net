# Paysera card payments for AUTOPJESA promotion packages

The site uses Paysera Checkout Classic and requests the `card` method for Kosovo (XK). Card details are entered on Paysera's hosted checkout page; AUTOPJESA does not collect or store card numbers.

## Merchant setup

1. Create a Paysera merchant project and activate Checkout.
2. Separately request approval for **online payment collection by payment cards**. Paysera requires card acquiring to be enabled for the merchant project before card transactions can be accepted.
3. Deploy this Node server at a public HTTPS URL. The Paysera callback endpoint must be reachable at `https://your-domain/api/paysera/callback`.
4. Copy `.env.example` to `.env` and set the approved Paysera project ID, project password, and public HTTPS URL. Keep `.env` private; it is excluded from Git.
5. Set `PAYMENT_TEST=1` only while using Paysera test mode. Switch to `0` after test payments and production activation.
6. Run `npm start` (Node.js 18 or newer). On a server/container, set `HOST=0.0.0.0` so the reverse proxy can reach Node; local development defaults to `127.0.0.1`.

The server creates EUR orders from the package and duration price table, signs the redirect request server-side, and activates an order only after a signed Paysera callback confirms the amount, currency, project, and successful payment. The browser return page checks the server status; it does not itself confirm payment.

This existing prototype stores users and listings in browser `localStorage`. The payment service persists payment orders on the server, but account identity and listings are not yet shared across devices. A production marketplace still needs server-side authentication and a database-backed account/listing system before package entitlements can be enforced across users and devices.
