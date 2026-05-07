"use strict";
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const { success, error } = require("../utils/apiResponse");
const { isCollegeEmail, detectCollege } = require("../utils/collegeDetect");
const { sendOTPEmail, sendResetEmail } = require("../utils/email");
const logger = require("../utils/logger");
const { buildCookieOptions } = require("../utils/cookieOptions");
const { isAdminEmail } = require("../utils/adminEmails");

const normalizeEmail = (email) =>
  String(email || "")
    .toLowerCase()
    .trim();

const isEmailDeliveryError = (err) =>
  /Email service|Invalid login|Authentication failed|Connection timeout|timed out|timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ESOCKET|EAUTH|ETLS/i.test(
    err.message || "",
  ) ||
  [
    "EAUTH",
    "ESOCKET",
    "ECONNECTION",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
  ].includes(err.code) ||
  err.responseCode;

const handleDuplicateEmail = (err, res) => {
  if (err?.code === 11000 && err?.keyPattern?.email) {
    return error(res, "An account with this email already exists", 409);
  }
  return null;
};

// ─── Token helpers ────────────────────────────────────────────────────────────
const cookieBase = () => buildCookieOptions({ httpOnly: true });

const issueTokens = async (user, res) => {
  // Include tokenVersion so we can invalidate old tokens
  const payload = {
    id: user._id,
    tv: user.tokenVersion ?? 0,
    jti: crypto.randomUUID(),
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  });

  // Store hashed refresh token in DB
  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await RefreshToken.create({ userId: user._id, tokenHash, expiresAt });

  res.cookie("cirql_access", accessToken, {
    ...cookieBase(),
    maxAge: 15 * 60 * 1000, // 15 min
  });
  res.cookie("cirql_refresh", refreshToken, {
    ...cookieBase(),
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  return { accessToken, refreshToken };
};

// ─── Register ─────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const emailLower = normalizeEmail(email);

    logger.debug(`[${req.requestId}] Register attempt for ${emailLower}`);
    if (!isCollegeEmail(emailLower)) {
      return error(
        res,
        "Only college email addresses are allowed (.edu / .ac.in)",
        400,
      );
    }

    let user = await User.findOne({ email: emailLower }).select(
      "+verifyOTPHash +verifyOTPExpiry +otpAttempts",
    );

    if (user) {
      if (user.isVerified) {
        return error(res, "An account with this email already exists", 409);
      }
      // Unverified — allow them to re-register (refreshes OTP)
      user.name = name.trim();
      user.password = password; // pre-save hook re-hashes
      if (isAdminEmail(emailLower)) user.role = "admin";
    } else {
      const info = detectCollege(emailLower);
      user = new User({
        name: name.trim(),
        email: emailLower,
        password,
        college: info?.college || "University Campus",
        collegeDomain: info?.domain || emailLower.split("@")[1],
        role: isAdminEmail(emailLower) ? "admin" : "user",
      });
    }

    const otp = user.createOTP(); // sets hash + expiry
    await user.save();

    const otpDelivery = await sendOTPEmail(emailLower, name.trim(), otp);

    const message = otpDelivery?.skipped
      ? "OTP generated. Check the backend console for the development OTP."
      : "OTP sent to your college email";

    return success(res, { userId: user._id }, message, 201);
  } catch (err) {
    const duplicateResponse = handleDuplicateEmail(err, res);
    if (duplicateResponse) return duplicateResponse;
    if (isEmailDeliveryError(err)) {
      logger.warn(
        `[${req.requestId}] OTP email delivery failed: ${err.response || err.message}`,
      );
      return error(
        res,
        "Could not send OTP email. Please check email configuration and try again.",
        503,
      );
    }
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Registration failed — please try again", 500);
  }
};

// ─── Verify OTP ───────────────────────────────────────────────────────────────
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email: normalizeEmail(email) }).select(
      "+verifyOTPHash +verifyOTPExpiry +otpAttempts +tokenVersion",
    );

    if (!user) return error(res, "No account found for this email", 404);
    if (user.isVerified)
      return error(res, "Email already verified — please log in", 400);

    // Brute-force guard: max 5 attempts per OTP
    if ((user.otpAttempts || 0) >= 5) {
      return error(
        res,
        "Too many failed attempts. Please request a new OTP.",
        429,
      );
    }

    if (!user.verifyOTP(otp)) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await User.updateOne(
        { _id: user._id },
        { $set: { otpAttempts: user.otpAttempts } },
      );
      const left = 5 - user.otpAttempts;
      return error(
        res,
        `Invalid or expired OTP. ${left} attempt(s) remaining.`,
        400,
      );
    }

    // Clear OTP fields
    user.isVerified = true;
    user.otpAttempts = 0;

    await User.updateOne(
      { _id: user._id },
      {
        $set: { isVerified: true, otpAttempts: 0 },
        $unset: { verifyOTPHash: 1, verifyOTPExpiry: 1 },
      },
    );

    const { accessToken } = await issueTokens(user, res);
    return success(
      res,
      { user: user.toPublicJSON(), accessToken },
      "Email verified — welcome to CirQl!",
    );
  } catch (err) {
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Verification failed — please try again", 500);
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Explicitly select password, tokenVersion, and lockout fields
    const emailLower = normalizeEmail(email);
    const user = await User.findOne({ email: emailLower }).select(
      "+password +tokenVersion +failedLoginAttempts +lockUntil",
    );

    // Use the same error message for both "no user" and "wrong password".
    // Dummy hash uses rounds=10 (same as BCRYPT_ROUNDS default) to prevent
    // timing-attack leakage without adding unnecessary latency.
    if (!user) {
      await bcrypt.compare(
        password,
        "$2a$10$zWLJlFUv2vFd/UXGYLFb9u/72aOl3iIYXArI9Zi4VILwWUTzNWwd.",
      );
      return error(res, "Invalid email or password", 401);
    }

    if (user.lockUntil && user.lockUntil > Date.now()) {
      return error(
        res,
        "Account temporarily locked. Please try again later.",
        401,
      );
    }

    if (!user.isVerified) {
      return error(res, "Please verify your email before logging in", 401);
    }

    const match = await user.comparePassword(password);
    if (!match) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const update = { $inc: { failedLoginAttempts: 1 } };
      if (attempts >= 5) {
        update.$set = { lockUntil: new Date(Date.now() + 15 * 60 * 1000) };
      }
      await User.updateOne({ _id: user._id }, update);
      return error(res, "Invalid email or password", 401);
    }

    if (isAdminEmail(emailLower) && user.role !== "admin") {
      user.role = "admin";
      await user.save();
    }

    // Reset lockout counters on success
    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0 }, $unset: { lockUntil: 1 } },
    );

    const { accessToken } = await issueTokens(user, res);
    return success(
      res,
      { user: user.toPublicJSON(), accessToken },
      "Logged in successfully",
    );
  } catch (err) {
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Login failed — please try again", 500);
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────
exports.logout = async (req, res) => {
  try {
    const refreshToken = req.cookies?.cirql_refresh;
    if (refreshToken) {
      const tokenHash = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");
      await RefreshToken.deleteOne({ tokenHash });
    }
    res.clearCookie("cirql_access", cookieBase());
    res.clearCookie("cirql_refresh", cookieBase());
    return success(res, null, "Logged out successfully");
  } catch (err) {
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Logout failed", 500);
  }
};

// ─── Refresh access token ─────────────────────────────────────────────────────
exports.refresh = async (req, res) => {
  try {
    const refreshToken = req.cookies?.cirql_refresh;
    if (!refreshToken)
      return error(res, "No refresh token — please log in", 401);

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      res.clearCookie("cirql_refresh", cookieBase());
      return error(
        res,
        "Invalid or expired refresh token — please log in",
        401,
      );
    }

    const user = await User.findById(decoded.id).select("+tokenVersion");
    if (!user) return error(res, "Account no longer exists", 401);

    if (user.tokenVersion !== (decoded.tv ?? 0)) {
      res.clearCookie("cirql_refresh", cookieBase());
      return error(res, "Session invalidated — please log in again", 401);
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");
    const tokenRecord = await RefreshToken.findOne({
      userId: user._id,
      tokenHash,
    });

    if (!tokenRecord) {
      res.clearCookie("cirql_refresh", cookieBase());
      return error(res, "Invalid refresh token", 401);
    }

    if (tokenRecord.used) {
      // Token reuse detected - invalidate completely
      await RefreshToken.deleteMany({ userId: user._id });
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save();
      res.clearCookie("cirql_refresh", cookieBase());
      return error(
        res,
        "Security alert: Token reuse detected. All sessions invalidated.",
        401,
      );
    }

    // Mark current token as used
    tokenRecord.used = true;
    await tokenRecord.save();

    const { accessToken } = await issueTokens(user, res);
    return success(res, { user: user.toPublicJSON(), accessToken });
  } catch (err) {
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Token refresh failed", 500);
  }
};

// ─── Resend OTP ───────────────────────────────────────────────────────────────
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const emailLower = normalizeEmail(email);
    const user = await User.findOne({ email: emailLower }).select(
      "+verifyOTPExpiry +otpAttempts +verifyOTPHash",
    );

    if (!user) return error(res, "No account found for this email", 404);
    if (user.isVerified) return error(res, "Email already verified", 400);

    // Throttle: don't allow resend if current OTP is <1 min old
    if (
      user.verifyOTPExpiry &&
      user.verifyOTPExpiry - Date.now() > 9 * 60 * 1000
    ) {
      return error(res, "Please wait before requesting a new OTP", 429);
    }

    const otp = user.createOTP();
    await user.save();

    await sendOTPEmail(emailLower, user.name, otp);
    return success(res, {}, "New OTP sent successfully");
  } catch (err) {
    if (isEmailDeliveryError(err)) {
      logger.warn(
        `[${req.requestId}] OTP resend email delivery failed: ${err.response || err.message}`,
      );
      return error(
        res,
        "Could not send OTP email. Please check email configuration and try again.",
        503,
      );
    }
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Failed to resend OTP", 500);
  }
};

// ─── Forgot Password ──────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const emailLower = normalizeEmail(email);
    const user = await User.findOne({ email: emailLower });

    // Always return success even if no user to prevent email enumeration
    if (!user)
      return success(
        res,
        {},
        "If an account with that email exists, we sent a password reset link.",
      );

    const resetToken = crypto.randomBytes(64).toString("hex");
    user.resetPasswordHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    await user.save();

    await sendResetEmail(emailLower, user.name, resetToken);
    return success(
      res,
      {},
      "If an account with that email exists, we sent a password reset link.",
    );
  } catch (err) {
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Failed to process forgot password request", 500);
  }
};

// ─── Reset Password ───────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const resetPasswordHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordHash,
      resetPasswordExpiry: { $gt: new Date() },
    }).select("+resetPasswordHash +resetPasswordExpiry +tokenVersion");

    if (!user)
      return error(res, "Invalid or expired password reset token", 400);

    user.password = newPassword; // Pre-save hook hashes it automatically
    user.resetPasswordHash = undefined;
    user.resetPasswordExpiry = undefined;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // Log them out from everywhere

    // Also explicitly destroy refresh tokens
    await RefreshToken.deleteMany({ userId: user._id });

    await user.save();

    return success(res, {}, "Password successfully reset. Please log in.");
  } catch (err) {
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Failed to reset password", 500);
  }
};

// ─── Change Password (Authenticated) ──────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.userId).select(
      "+password +tokenVersion",
    );

    if (!user) return error(res, "Account not found", 404);

    const match = await user.comparePassword(currentPassword);
    if (!match) return error(res, "Current password is incorrect", 401);

    user.password = newPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // Invalidate all sessions except one they're currently doing? For now, kicks out all.
    await RefreshToken.deleteMany({ userId: user._id });

    await user.save();

    return success(
      res,
      {},
      "Password successfully changed. Please log in again.",
    );
  } catch (err) {
    logger.error(`[${req.requestId}] ${err.message}`, err);
    return error(res, "Failed to change password", 500);
  }
};
