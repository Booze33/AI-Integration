# AI Integration Boilerplate

Launch your AI SaaS in days, not months.

A production-ready starter for teams that need user accounts, tenant-safe data boundaries, chat, uploads, and admin settings already connected.

## Why Buyers Choose This

Most teams burn their first sprint on backend plumbing that customers never see.

This gives you a working product base on day one so you can spend your time on the part people will pay for.

## Built For

- Founders who need a fast path to first customer
- Product teams shipping internal or client-facing AI apps
- Agencies that want one solid base for repeat client work

## What You Get (And Why It Matters)

- Login and sign-up already working, so you can onboard real users immediately.
- Tenant account boundaries in place, so customer data stays separated and sellable to serious buyers.
- Streaming chat and history, so the product feels fast and usable from the first demo.
- File upload plus processing flow, so users can work with their own documents right away.
- Per-account AI provider settings, so customers can bring their own keys and control spend.
- Session controls for admins, so access can be revoked quickly when needed.

## Setup Reality Check

Typical setup time on a prepared machine: 15 to 25 minutes.

```bash
pnpm install
cp .env.example .env
cp packages/backend/.env.example packages/backend/.env
cp packages/frontend/.env.example packages/frontend/.env.local
docker compose up -d
pnpm --filter backend run generate-keys
pnpm dev
```

Then open:

- http://localhost:3000 (frontend)
- http://localhost:3001 (backend)

## Not Included

- No managed hosting service
- No done-for-you product strategy
- No automatic compliance certification
- No custom integrations for your internal systems

## Strong Fit If

You want to own your code, move fast, and ship a serious AI product without rebuilding the basics.

## Call To Action

Start from this base, ship your first customer-facing version this week, and spend your energy on your differentiator instead of infrastructure.
