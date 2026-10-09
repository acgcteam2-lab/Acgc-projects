import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Admin from "../models/Admin.js";

/**
 * Authentication Middleware
 * Verifies JWT token from Authorization header
 */
export const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );

    let account;
    if (decoded.auth_source === "admin") {
      account = await Admin.findById(decoded.id).select("session_version email first_name last_name phone role").lean();
    } else if (decoded.auth_source === "user") {
      account = await User.findById(decoded.id).select("session_version email first_name last_name phone role").lean();
    } else if (decoded.role === "admin") {
      account = await Admin.findById(decoded.id).select("session_version email first_name last_name phone role").lean()
        || await User.findById(decoded.id).select("session_version email first_name last_name phone role").lean();
    } else {
      account = await User.findById(decoded.id).select("session_version email first_name last_name phone role").lean();
    }

    if (!account || Number(decoded.session_version || 0) !== Number(account.session_version || 0)) {
      return res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "Your session is no longer valid. Please sign in again.",
      });
    }

    // Attach user info to request
    req.user = { ...decoded, ...account, id: decoded.id, role: decoded.role || account.role };
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      error: error.message,
    });
  }
};

/**
 * Role Check Middleware
 * Verifies user has required role
 */
export const roleMiddleware = (requiredRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const roles = Array.isArray(requiredRoles)
      ? requiredRoles
      : [requiredRoles];

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    next();
  };
};

export const staffModulePermission = (moduleFromRequest, action = "view") => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (req.user.role === "admin") return next();
    if (req.user.role !== "skilled_worker") {
      return res.status(403).json({ success: false, message: "Insufficient permissions" });
    }

    const moduleKey = typeof moduleFromRequest === "function" ? moduleFromRequest(req) : moduleFromRequest;
    const user = await User.findById(req.user.id).select("staff_access").lean();
    const moduleAccess = user?.staff_access?.modules?.[moduleKey];
    if (!moduleAccess?.enabled || moduleAccess.actions?.[action] !== true) {
      return res.status(403).json({ success: false, message: "This staff module or action is disabled for your account." });
    }

    req.staffAccessModule = moduleKey;
    req.staffAccess = user.staff_access;
    next();
  } catch (error) {
    console.error("Staff module permission error:", error);
    res.status(500).json({ success: false, message: "Unable to verify staff access." });
  }
};

export const permissionMiddleware = (permission) => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (req.user.role !== "customer") return next();

    const user = await User.findById(req.user.id).select("access_permissions").lean();
    const permissions = user?.access_permissions || {};
    const allowed = !permissions.view_only_access && permissions[permission] !== false;
    if (!allowed) {
      return res.status(403).json({ success: false, message: "This action is disabled for your account." });
    }
    next();
  } catch (error) {
    console.error("Permission middleware error:", error);
    res.status(500).json({ success: false, message: "Unable to verify account permissions." });
  }
};
