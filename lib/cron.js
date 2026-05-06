const cron = require("cron");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const SCHEDULE = "*/14 * * * *";
const API_URL = String(process.env.API_URL || "").trim();

const isValidUrl = (value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const createJob = () => {
  if (!API_URL) {
    console.warn("[CRON] API_URL is not configured. Cron job disabled.");
    return null;
  }

  if (!isValidUrl(API_URL)) {
    console.warn(`[CRON] API_URL is invalid: ${API_URL}. Cron job disabled.`);
    return null;
  }

  const url = new URL(API_URL);
  const client = url.protocol === "http:" ? http : https;

  return new cron.CronJob(SCHEDULE, () => {
    client
      .get(url, (res) => {
        if (res.statusCode === 200) {
          console.info(`[CRON] GET ${API_URL} succeeded`);
        } else {
          console.warn(`[CRON] GET ${API_URL} returned ${res.statusCode}`);
        }
        res.resume();
      })
      .on("error", (err) => {
        console.error(`[CRON] GET ${API_URL} failed: ${err.message}`);
      });
  });
};

let job;

const start = () => {
  if (job) return;
  job = createJob();
  if (!job) return;
  job.start();
  console.info(`[CRON] Scheduled job every 14 minutes for ${API_URL}`);
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
// 14 * * * * - Every 14 minutes
// 0 0 * * 0 - At midnight on every Sunday
// 30 3 15 * * - At 3:30 AM, on the 15th of every month
// 0 0 1 1 * - At midnight, on January 1st
// 0 * * * * - Every hour
