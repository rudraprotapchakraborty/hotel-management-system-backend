import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import userRoutes from "../modules/users/user.routes";
import mealRoutes from "../modules/meals/meal.routes";
import reviewRoutes from "../modules/reviews/review.routes";
import requestRoutes from "../modules/requests/request.routes";
import cartRoutes from "../modules/cart/cart.routes";
import paymentRoutes from "../modules/payments/payment.routes";
import dashboardRoutes from "../modules/dashboard/dashboard.routes";
import adminRoutes from "../modules/admin/admin.routes";
import uploadRoutes from "../modules/uploads/upload.routes";
import publicRoutes from "../modules/public/public.routes";
import { apiLimiter } from "../core/rate-limit";

const router = Router();

router.use(apiLimiter);

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/meals", mealRoutes);
router.use("/reviews", reviewRoutes);
router.use("/requests", requestRoutes);
router.use("/cart", cartRoutes);
router.use("/payments", paymentRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/admin", adminRoutes);
router.use("/uploads", uploadRoutes);
router.use("/public", publicRoutes);

export default router;
