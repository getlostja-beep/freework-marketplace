# FreeWork Marketplace

A self-hostable freelance marketplace starter with a dark charcoal / white / electric-cyan visual identity. The project includes a working Express API, SQLite database, session authentication, client/freelancer roles, project listings, proposals, messaging, reviews, reports, and admin endpoints.

## Important scope note

This is a runnable **starter MVP**, not a production-certified platform or a deployed public service. The included landing page wires up registration/login, project browsing/search, freelancer browsing/search, and proposal submission. Several backend capabilities (dashboard data, messages, reviews, admin management, report handling) are available through the API but still need complete user-facing dashboard screens. File attachments, email delivery, live WebSocket updates, escrow/payment processing, and a formal identity-verification vendor are not included. No payment processing is required to use the platform's core code.

## Requirements

- Node.js 20 or newer
- npm
- No paid API keys are needed to run locally.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `SESSION_SECRET` to a random secret of at least 32 characters.
3. Set a strong `ADMIN_PASSWORD` and your preferred `ADMIN_EMAIL` (do not use the example password).
4. Install and run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

The admin account is created on first startup only if both admin variables are set and `ADMIN_PASSWORD` is not the example placeholder. Change/rotate credentials before deployment. Keep `.env` private.

## Environment variables

- `PORT`: web server port (default 3000)
- `NODE_ENV`: set `production` on deployment to enable secure session cookies
- `SESSION_SECRET`: required, 32+ characters
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: bootstrap an administrator
- `APP_ORIGIN`: optional exact origin allow-list for state-changing API requests
- `DB_PATH`: optional path to SQLite database file

## Database

SQLite tables are created automatically at startup:
- `users`: account credentials, role, profile, skills, portfolio, verification flag
- `jobs`: client-owned projects and statuses
- `proposals`: freelancer applications, bids and decisions
- `messages`: direct messages, optionally associated with a project
- `reviews`: participant ratings after a job is marked completed
- `milestones`: milestone schema for future milestone UI/API work
- `reports`: user-submitted reports and admin review status

SQLite files and session storage are created on the server. Back up persistent data before upgrading.

## API overview

All API paths are under `/api`. Authentication uses an HTTP-only session cookie.

- `GET /health`, `GET /me`
- `POST /auth/register` — `name`, `email`, `password` (10+ chars), `role` (`client` or `freelancer`)
- `POST /auth/login` — `email`, `password`
- `POST /auth/logout`
- `GET /freelancers?q=...`, `GET /freelancers/:id`
- `PUT /profile` — `bio`, `skills`, `portfolio`
- `GET /jobs?q=...&status=open`
- `POST /jobs` — client/admin, `title`, `description`, `skills`, `budget`
- `GET /jobs/:id`
- `POST /jobs/:id/proposals` — freelancer, `cover_letter`, `bid`
- `POST /proposals/:id/decision` — client owner/admin, `status=accepted|rejected`
- `GET /dashboard` — role-dependent jobs, proposals and recent messages
- `GET /messages/:otherId`, `POST /messages` — `receiver_id`, `body`, optional `job_id`
- `POST /reviews` — `job_id`, `reviewee_id`, `rating`, `comment`
- `POST /reports` — `reason`, optional `reported_user_id`, `job_id`
- `GET /admin/overview` — admin only
- `PATCH /admin/users/:id` — admin verification flag
- `PATCH /admin/jobs/:id` — admin job status
- `PATCH /admin/reports/:id` — admin report status

## Security notes before public launch

The app uses password hashing (bcrypt), parameterized SQL, Helmet headers, role checks, rate limiting on authentication routes, server-side input validation, session regeneration after login, and HTTP-only / SameSite cookies. This is a baseline, not a complete security audit.

Before a public launch:
- Set `NODE_ENV=production`, HTTPS, strong secrets, and a correct `APP_ORIGIN`.
- Use persistent storage. Many free hosting tiers use ephemeral filesystems; SQLite and session files can disappear after redeploy/restart unless persistent disk is provided.
- Add CSRF tokens or a robust same-origin strategy for all authenticated mutations, test origin behavior behind your reverse proxy, and add stricter rate limits for messages and submissions.
- Add email verification, password reset, account deletion/export, moderation workflow, abuse detection, backups, monitoring, accessibility testing, and security review.
- Implement and test complete dashboard screens, milestone lifecycle, attachment storage/scanning, notifications, dispute workflow, and a proper verification process.
- Never store payment-card data yourself. If you later add optional payments, a payment provider may charge processing fees. Such fees are external, not FreeWork platform commissions.

## Free hosting considerations

Hosting providers change their free-tier limits and terms. Free tiers may sleep, impose monthly build/runtime caps, or not include persistent disks. Deploy this Node app only on a host that supports a persistent writable disk for SQLite, or migrate to a managed database supported by your chosen host. No hosting plan is bundled or guaranteed free. A custom domain, email/SMS delivery, file storage, backups, or payment processing may incur third-party costs.

## Legal pages

Before inviting real users, have jurisdiction-appropriate Terms of Service, Privacy Policy, Community Guidelines, and a contact / complaint process reviewed and published. This starter intentionally does not invent legal promises for your jurisdiction.
