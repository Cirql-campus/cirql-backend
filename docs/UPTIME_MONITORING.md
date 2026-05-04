# Uptime Monitoring

Use an external uptime monitor so you get an alert when the backend is down.

## Backend Health URL

Set the monitor URL to:

```text
https://your-backend-domain.com/health
```

The endpoint returns `200` when the API and MongoDB are healthy, and `503` when the database is disconnected.

## Recommended Setup

Use one of these services:

- Better Stack Uptime
- UptimeRobot
- Pingdom

Suggested monitor settings:

- Check interval: `1 minute`
- Timeout: `10 seconds`
- Alert after: `2 failed checks`
- Alert channels: email first, then WhatsApp/Slack later

## What To Watch

- HTTP status is not `200`
- Response time is consistently above `2000ms`
- `/health` reports `database: disconnected`
- Sentry starts showing repeated `500` or timeout errors

## Launch Rule

Do not invite real campus users until the monitor has been running successfully for at least 24 hours.
