import { Router } from "express";
import { Meal } from "../../models/Meal";
import { Plan } from "../../models/Plan";
import { User } from "../../models/User";

const router = Router();

/** Aggregate counts only (no personal data) for the landing page. */
router.get("/stats", async (_req, res) => {
  const [meals, upcoming, members] = await Promise.all([
    Meal.countDocuments({ upcoming: false }),
    Meal.countDocuments({ upcoming: true }),
    User.countDocuments({ emailVerified: true, isBlocked: false }),
  ]);
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ success: true, data: { meals, upcoming, members } });
});

/** Membership plans, cheapest first. */
router.get("/plans", async (_req, res) => {
  const plans = await Plan.find().sort({ price: 1 });
  res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
  res.json({
    success: true,
    data: plans.map((p) => ({ id: String(p._id), name: p.name, badge: p.badge, price: p.price, description: p.description, features: p.features })),
  });
});

export default router;
