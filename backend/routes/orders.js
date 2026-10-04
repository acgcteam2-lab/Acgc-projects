import express from "express";
import { authMiddleware, permissionMiddleware, roleMiddleware, staffModulePermission } from "../middleware/auth.js";
import {
  createOrder,
  createOrderAsAdmin,
  listOrders,
  trackOrder,
  getProductReviews,
  getAdminOrders,
  getAdminOrderById,
  updateOrderStatus,
  updateOrderInspection,
  updateOrderProgress,
  generateContract,
  submitOrderReview,
  deleteOrderReview,
  respondToContract,
  cancelCustomerOrder,
  submitCustomerPaymentProof,
  respondToInstallationSchedule,
  sendWalkInApprovalEmail,
} from "../controllers/orderController.js";

const router = express.Router();

router.get("/", authMiddleware, listOrders);
router.post("/", authMiddleware, roleMiddleware("customer"), permissionMiddleware("can_request_orders"), createOrder);
router.get("/track/:tracking", trackOrder);
router.put("/:orderId/contract", authMiddleware, roleMiddleware("customer"), respondToContract);
router.put("/:orderId/cancel", authMiddleware, roleMiddleware("customer"), cancelCustomerOrder);
router.put("/:orderId/payment-proof", authMiddleware, roleMiddleware("customer"), submitCustomerPaymentProof);
router.put("/:orderId/installation-schedule", authMiddleware, respondToInstallationSchedule);
router.put("/:orderId/review", authMiddleware, roleMiddleware("customer"), permissionMiddleware("can_upload_feedback"), submitOrderReview);
router.get("/reviews/product/:productId", authMiddleware, permissionMiddleware("can_upload_feedback"), getProductReviews);

// Admin routes
router.get("/admin/list", authMiddleware, staffModulePermission((req) => req.query.module), getAdminOrders);
router.get("/admin/:orderId", authMiddleware, staffModulePermission((req) => req.query.module), getAdminOrderById);
router.post("/admin/create", authMiddleware, roleMiddleware("admin"), createOrderAsAdmin);
router.put("/admin/:orderId/status", authMiddleware, roleMiddleware("admin"), updateOrderStatus);
router.delete("/admin/:orderId/review", authMiddleware, roleMiddleware("admin"), deleteOrderReview);
router.put("/admin/:orderId/inspection", authMiddleware, roleMiddleware("admin"), updateOrderInspection);
router.put("/admin/:orderId/progress", authMiddleware, roleMiddleware("admin"), updateOrderProgress);
router.post("/admin/:orderId/contract", authMiddleware, roleMiddleware("admin"), generateContract);
router.post("/admin/:orderId/send-contract-email", authMiddleware, roleMiddleware("admin"), sendWalkInApprovalEmail);

export default router;
