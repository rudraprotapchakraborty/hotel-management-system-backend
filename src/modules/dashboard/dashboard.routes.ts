import { Router, Response } from "express";
import { Types } from "mongoose";
import { AuthRequest, authMiddleware } from "../../core/auth-middleware";
import { CartItem } from "../../models/CartItem";
import { MealLike } from "../../models/MealLike";
import { MealRequest } from "../../models/MealRequest";
import { MealReview } from "../../models/MealReview";
import { Payment } from "../../models/Payment";
import { User } from "../../models/User";

const router = Router();
router.use(authMiddleware);

/** The numbers on a member's dashboard home. */
router.get("/summary", async (req: AuthRequest, res: Response) => {
  const id = req.user!.id;
  const [me, orders, spent, reviews, pending, served, likes, cart] = await Promise.all([
    User.findById(id).select("badge"),
    Payment.countDocuments({ user: id, status: "paid" }),
    Payment.aggregate([{ $match: { user: new Types.ObjectId(id), status: "paid" } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    MealReview.countDocuments({ user: id }),
    MealRequest.countDocuments({ user: id, status: "PENDING" }),
    MealRequest.countDocuments({ user: id, status: "SERVED" }),
    MealLike.countDocuments({ user: id }),
    CartItem.countDocuments({ user: id }),
  ]);
  res.json({
    success: true,
    data: { badge: me?.badge ?? "bronze", orders, spent: Math.round((spent[0]?.total ?? 0) * 100) / 100, reviews, pendingRequests: pending, servedRequests: served, likes, cartItems: cart },
  });
});


export default router;
