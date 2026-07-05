const cron = require("cron");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const SCHEDULE = "*/14 * * * *";
const API_URL = String(process.env.API_URL || "").trim();

const getResolvedUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/health";
    }
    return url.toString();
  } catch {
    return null;
  }
};

const createJob = (resolvedUrl) => {
  if (!resolvedUrl) return null;

  try {
    const url = new URL(resolvedUrl);
    const client = url.protocol === "http:" ? http : https;

    return new cron.CronJob(SCHEDULE, () => {
      client
        .get(resolvedUrl, (res) => {
          if (res.statusCode === 200) {
            console.info(`[CRON] GET ${resolvedUrl} succeeded`);
          } else {
            console.warn(`[CRON] GET ${resolvedUrl} returned ${res.statusCode}`);
          }
          res.resume();
        })
        .on("error", (err) => {
          console.error(`[CRON] GET ${resolvedUrl} failed: ${err.message}`);
        });
    });
  } catch (err) {
    console.error(`[CRON] Failed to initialize cron client: ${err.message}`);
    return null;
  }
};

let job;

const start = () => {
  if (job) return;

  if (!API_URL) {
    console.warn("[CRON] WARNING: API_URL environment variable is missing. Self-ping cron job is disabled. The server may spin down on inactivity in Render's free tier.");
    return;
  }

  const resolvedUrl = getResolvedUrl(API_URL);
  if (!resolvedUrl) {
    console.warn(`[CRON] WARNING: API_URL is invalid: "${API_URL}". Self-ping cron job is disabled.`);
    return;
  }

  job = createJob(resolvedUrl);
  if (!job) return;
  job.start();
  console.info(`[CRON] Scheduled self-ping job every 14 minutes targeting resolved URL: ${resolvedUrl}`);

  // Startup-time sanity check
  const hasPlaceholder = resolvedUrl.includes("your-backend-name");
  if (hasPlaceholder) {
    console.error(`
######################################################################
[CRON] ERROR: API_URL contains the placeholder substring "your-backend-name"!
Current resolved URL: ${resolvedUrl}
This cron job WILL NOT prevent Render free-tier spin-down.
Please set the API_URL environment variable to the correct backend URL
in the Render dashboard (e.g., https://cirql-backend.onrender.com).
######################################################################
`);
  } else {
    // Perform asynchronous URL reachability check after 5 seconds to allow boot
    setTimeout(() => {
      try {
        const url = new URL(resolvedUrl);
        const client = url.protocol === "http:" ? http : https;
        const req = client.get(resolvedUrl, (res) => {
          if (res.statusCode !== 200) {
            console.error(`
######################################################################
[CRON] WARNING: Reachability check failed for resolved URL on boot!
GET ${resolvedUrl} returned status code: ${res.statusCode}
Please verify your API_URL environment variable is correct.
######################################################################
`);
          } else {
            console.info(`[CRON] Boot-time reachability check succeeded for ${resolvedUrl}`);
          }
          res.resume();
        });

        req.on("error", (err) => {
          console.error(`
######################################################################
[CRON] WARNING: Reachability check failed for resolved URL on boot!
GET ${resolvedUrl} failed with error: ${err.message}
Please verify your API_URL environment variable is correct and reachable.
######################################################################
`);
        });

        req.setTimeout(8000, () => {
          req.destroy();
          console.error(`
######################################################################
[CRON] WARNING: Reachability check timed out for resolved URL on boot!
GET ${resolvedUrl} did not respond within 8 seconds.
######################################################################
`);
        });
      } catch (err) {
        console.error(`[CRON] Reachability check failed to initialize: ${err.message}`);
      }
    }, 5000);
  }
};

const stop = () => {
  if (!job) return;
  job.stop();
  job = null;
  console.info("[CRON] Scheduled job stopped");
};

module.exports = { start, stop };

// CRON JOB EXPLANATION:
// Cron jobs are scheduled tasks that run periodically at fixed intervals
// we want to send 1 GET request for every 14 minutes

// How to define a "Schedule"?
// You define a schedule using a cron expression, which consists of 5 fields representing:

// MINUTE, HOUR, DAY OF THE MONTH, MONTH, DAY OF THE WEEK

// EXAMPLES && EXPLANATION:
// */14 * * * * - Every 14 minutes
// 0 0 * * 0 - At midnight on every Sunday
// 30 3 15 * * - At 3:30 AM, on the 15th of every month
// 0 0 1 1 * - At midnight, on January 1st
// 0 * * * * - Every hour
