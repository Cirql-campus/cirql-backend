# CirQl Production Runbook

## Required Before Launch

- Set real production values for all required variables in `.env.example`.
- Set `REDIS_URL` in production so rate limits, cache, and Socket.io scale across workers.
- Set `SENTRY_DSN` to capture backend crashes and 500 responses.
- Run `npm run migrate:production-fields` once after deploying these schema changes.
- Run `npm run audit` and `npm run test:ci` before release.

## Test Database

Local Windows machines can block `mongodb-memory-server`. Use a disposable database:

```powershell
$env:TEST_MONGODB_URI="mongodb://localhost:27017/cirql_test"
npm test
```

The test guard requires `TEST_MONGODB_URI` to include `test` or `ci`, unless `ALLOW_TEST_DB_DROP=true`.

## Backups

- Enable MongoDB Atlas daily backups with point-in-time recovery.
- Test a restore into a staging database before launch.
- Keep Cloudinary originals enabled for listing images.
- Export Cloudinary assets periodically if your plan supports backup/export jobs.
- Store `.env` secrets in the deployment platform, never in source control.

## Monitoring

- `/health` returns MongoDB, Redis, and monitoring status.
- Sentry captures uncaught 500 errors when `SENTRY_DSN` is configured.
- Add an uptime monitor against `/health` with alerts to email/Slack.
- Watch the admin dashboard queues:
  - `GET /api/v1/admin/dashboard`
  - `GET /api/v1/admin/listing-reports`
  - `GET /api/v1/admin/message-reports`
  - `GET /api/v1/admin/user-reports`

## Moderation Flow

- New listing/user/message reports enter `open`.
- Admin can move reports to `reviewed`, `dismissed`, or `actioned`.
- Message report status can also hide a message from chat history with `hiddenByAdmin=true`.
- Listing moderation notifies the seller when approved, rejected, or moved back to pending.

## Reviews

Until the deal/order system exists, reviews are restricted to users who:

- share a conversation on a seller-owned listing,
- both sent at least one message in that conversation,
- and the listing is marked `sold`.

This is safer than open reviews, but the future order system should replace it with true completed-deal verification.
