"use strict";
const logger = require("./logger");

const PLACEHOLDER_VALUES = new Set([
  "",
  "replace_me",
  "changeme",
  "change_me",
  "your_email",
  "your_password",
]);

const isPlaceholder = (value) =>
  PLACEHOLDER_VALUES.has(
    String(value || "")
      .trim()
      .toLowerCase(),
  );

// We now only check EMAIL_PASS since it acts as the Brevo API Key
const isEmailConfigured = () => !isPlaceholder(process.env.EMAIL_PASS);

const handleMissingEmailConfig = (message) => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Email service is not configured");
  }
  logger.warn(message);
};

const sendBrevoEmail = async ({ to, subject, html, text }) => {
  const apiKey = process.env.EMAIL_PASS;
  const senderName = process.env.EMAIL_FROM_NAME || "CirQl 🎓";
  const senderEmail = process.env.EMAIL_FROM_ADDRESS || "noreply@cirql.in";

  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorData = await res.text();
      throw new Error(`Brevo API Error: ${res.status} - ${errorData}`);
    }

    return await res.json();
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
};

/**
 * Send OTP verification email.
 * @param {string} to
 * @param {string} name
 * @param {string} otp  — plain text (shown in email, never stored)
 */
const sendOTPEmail = async (to, name, otp) => {
  if (!isEmailConfigured()) {
    handleMissingEmailConfig(
      `[DEV OTP] Email service not configured; OTP for ${to}: ${otp}`,
    );
    return { skipped: true };
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
        <!-- Header -->
        <tr>
          <td style="padding:36px 40px 28px;text-align:center;border-bottom:1px solid #1a1a1a;">
            <div style="font-size:30px;font-weight:900;letter-spacing:-1px;">
              <span style="color:#fff;">Cir</span><span style="color:#23d160;">Q</span><span style="color:#fff;">l</span>
            </div>
            <p style="color:#555;font-size:13px;margin:6px 0 0;">Campus Marketplace</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <h2 style="color:#fff;font-size:22px;margin:0 0 12px;">Hey ${escapeHtml(name)} 👋</h2>
            <p style="color:#888;font-size:15px;line-height:1.7;margin:0 0 28px;">
              Use this one-time code to verify your CirQl account. 
              It expires in <strong style="color:#fff;">10 minutes</strong>.
            </p>
            <!-- OTP box -->
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:14px;
                        padding:28px;text-align:center;margin-bottom:28px;">
              <div style="font-size:46px;font-weight:900;letter-spacing:10px;color:#23d160;
                          font-family:'Courier New',monospace;">${otp}</div>
              <p style="color:#444;font-size:12px;margin:12px 0 0;">
                Expires in 10 minutes • Do not share this code
              </p>
            </div>
            <p style="color:#444;font-size:13px;text-align:center;margin:0;">
              If you didn't create a CirQl account, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #1a1a1a;text-align:center;">
            <p style="color:#333;font-size:12px;margin:0;">
              © ${new Date().getFullYear()} CirQl • Campus-only marketplace
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await sendBrevoEmail({
    to,
    subject: `${otp} — Your CirQl Verification Code`,
    html,
    text: `Your CirQl verification code is: ${otp}\nIt expires in 10 minutes.`,
  });
};

/** Minimal HTML escaping to prevent name injection in the email */
const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Send Password Reset email.
 * @param {string} to
 * @param {string} name
 * @param {string} plainToken
 */
const sendResetEmail = async (to, name, plainToken) => {
  const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${plainToken}`;
  if (!isEmailConfigured()) {
    handleMissingEmailConfig(
      `[DEV RESET] Email service not configured; reset link for ${to}: ${resetLink}`,
    );
    return { skipped: true };
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
        <tr>
          <td style="padding:36px 40px 28px;text-align:center;border-bottom:1px solid #1a1a1a;">
            <div style="font-size:30px;font-weight:900;letter-spacing:-1px;">
              <span style="color:#fff;">Cir</span><span style="color:#23d160;">Q</span><span style="color:#fff;">l</span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <h2 style="color:#fff;font-size:22px;margin:0 0 12px;">Hey ${escapeHtml(name)} 👋</h2>
            <p style="color:#888;font-size:15px;line-height:1.7;margin:0 0 28px;">
              We received a request to reset your password. Click the button below to set a new password. 
              This link expires in <strong style="color:#fff;">15 minutes</strong>.
            </p>
            <div style="text-align:center;margin-bottom:28px;">
              <a href="${escapeHtml(resetLink)}" style="display:inline-block;background:#23d160;color:#000;font-weight:bold;
                 text-decoration:none;padding:14px 28px;border-radius:8px;">Reset Password</a>
            </div>
            <p style="color:#444;font-size:13px;text-align:center;margin:0;">
              If you didn't request a password reset, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await sendBrevoEmail({
    to,
    subject: `Reset Your CirQl Password`,
    html,
    text: `Reset your password using this link (expires in 15 mins): ${resetLink}`,
  });
};

module.exports = { sendOTPEmail, sendResetEmail, isEmailConfigured };
