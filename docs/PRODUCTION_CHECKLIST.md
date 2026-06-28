# CirQl Production Checklist

Use this before putting the campus marketplace in front of real users.

## Required Services

- MongoDB Atlas database with automated backups enabled.
- Cloudinary account with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
- Email SMTP provider now, then Resend/SendGrid/Mailgun after the domain is ready.
- Sentry project for backend error monitoring.
- Sentry project for frontend error monitoring.
- Uptime monitor such as Better Stack Uptime or UptimeRobot pointed at `/health`.
- Frontend host such as Vercel or Netlify.
- Backend host such as Render, Railway, Fly.io, or AWS.

## Backend Environment

- `NODE_ENV=production`
- `MONGODB_URI` points to the hosted production database.
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `FIELD_ENCRYPTION_KEY` are unique and at least 32 characters.
- `FRONTEND_URL` uses the deployed `https://` frontend URL.
- `FRONTEND_ORIGINS` contains only deployed `https://` origins.
- `ADMIN_EMAILS` contains only trusted admin college emails.
- `SENTRY_DSN` is set before launch.
- Backend logs are visible in the hosting dashboard and include crash/restart history.
- `API_URL` is set to this backend's own public health URL (e.g. `https://yourbackend.onrender.com/health`). Verify in the hosting dashboard logs that `[CRON] GET ... succeeded` actually appears every ~14 minutes after deploy. If it doesn't appear, the env var is missing or misconfigured.
- `REQUEST_TIMEOUT_MS` is set between `30000` and `60000` depending on hosting speed.
- Cloudinary keys are set and the API secret has been rotated after any accidental exposure.

## Frontend Environment

- `VITE_API_ORIGIN` points to the deployed backend origin.
- `VITE_SENTRY_DSN` points to the frontend Sentry project.
- Login, signup, OTP, forgot password, reset password, marketplace, chat, listing post, wanted item, and admin routes are tested against production backend.
- Trigger one slow request or stopped backend check and confirm the frontend shows a friendly error instead of a blank/broken page.

## Launch Tests

- Create a new student account with OTP.
- Reset password using the email link.
- Post a listing with a large phone photo and confirm compression/upload works.
- Create a Wanted Item and respond from another account in the same college.
- Confirm a different college cannot see that Wanted Item.
- Start chat from listing and Wanted Item flows.
- Delete a listing and confirm Cloudinary images are removed.
- Use admin account to review reports, flagged listings, pending listings, and user ban/unban.
- Run a small load test for login, listing browse, chat send, reports, and listing creation before inviting a full campus.
- Confirm pagination/load-more works for listings, messages, conversations, deals, notifications, admin lists, and wanted items.
- Confirm uptime monitor alerts are delivered when the backend is stopped or `/health` returns non-200.

## Operational Habits

- Check Cloudinary usage weekly.
- Check Sentry errors daily after launch.
- Check uptime monitor incidents after every deploy.
- Keep database backups enabled.
- Rotate secrets after sharing or compromise.
- Review admin report queues regularly.
- Watch rate-limit responses and server timeout logs after launch; raise limits only after checking abuse patterns.
