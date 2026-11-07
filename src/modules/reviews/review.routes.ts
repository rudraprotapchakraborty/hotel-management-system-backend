import { Router, Request, Response } from "express";
import { z } from "zod";
import { AuthRequest, authMiddleware } from "../../core/auth-middleware";
import { HttpException } from "../../core/http-exception";
import { objectIdSchema } from "../../core/object-id";
import { validateRequest } from "../../core/validate-request";
import { Meal } from "../../models/Meal";
import { IMealReview, MealReview } from "../../models/MealReview";
import { Testimonial } from "../../models/Testimonial";
import { refreshRatings } from "../users/user.cleanup";

const router = Router();

type Reviewer = { _id: unknown; fullName: string; profileImageUrl?: string; badge?: string };

const shape = (r: IMealReview) => {
  const user = r.user as unknown as Reviewer | null;
  const meal = r.meal as unknown as { _id: unknown; name: string; image: string } | null;
  return {
    id: String(r._id),
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    user: user && typeof user === "object" && "fullName" in user ? { id: String(user._id), name: user.fullName, image: user.profileImageUrl ?? null, badge: user.badge ?? "bronze" } : null,
    meal: meal && typeof meal === "object" && "name" in meal ? { id: String(meal._id), name: meal.name, image: meal.image } : null,
  };
};

const reviewBody = z.object({ rating: z.coerce.number().int().min(1, "Choose a rating").max(5), comment: z.string().trim().min(3, "Write at least a few words").max(500) });
const upsertSchema = z.object({ params: z.object({ mealId: objectIdSchema }), body: reviewBody });
const mealIdSchema = z.object({ params: z.object({ mealId: objectIdSchema }) });
const idSchema = z.object({ params: z.object({ id: objectIdSchema }) });

/** What guests said about the hotel, shown on the home page. */
router.get("/testimonials", async (_req: Request, res: Response) => {
  const rows = await Testimonial.find().limit(12);
  res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
  res.json({ success: true, data: rows.map((t) => ({ id: String(t._id), name: t.name, details: t.details, rating: t.rating })) });
});

/** Reviews of one meal, newest first. */
router.get("/meal/:mealId", validateRequest(mealIdSchema), async (req: Request, res: Response) => {
  const rows = await MealReview.find({ meal: req.params.mealId }).sort({ updatedAt: -1 }).limit(50).populate({ path: "user", select: "fullName profileImageUrl badge" });
  res.json({ success: true, data: rows.map(shape) });
});

/** Adds or edits my review of a meal (one per person). */
router.put("/meal/:mealId", authMiddleware, validateRequest(upsertSchema), async (req: AuthRequest, res: Response) => {
  const meal = await Meal.findById(req.params.mealId).select("upcoming");
  if (!meal) throw new HttpException(404, "That meal was not found");
  if (meal.upcoming) throw new HttpException(400, "Upcoming meals cannot be reviewed yet");
  const review = await MealReview.findOneAndUpdate(
    { meal: meal._id, user: req.user!.id },
    { $set: { rating: req.body.rating, comment: req.body.comment } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  await refreshRatings([meal._id]);
  await review.populate({ path: "user", select: "fullName profileImageUrl badge" });
  res.json({ success: true, data: shape(review) });
});

/** My reviews across the menu. */
router.get("/mine", authMiddleware, async (req: AuthRequest, res: Response) => {
  const rows = await MealReview.find({ user: req.user!.id }).sort({ updatedAt: -1 }).populate({ path: "meal", select: "name image" });
  res.json({ success: true, data: rows.map(shape) });
});

/** The author, or an admin moderating, may delete a review. */
router.delete("/:id", authMiddleware, validateRequest(idSchema), async (req: AuthRequest, res: Response) => {
  const review = await MealReview.findById(req.params.id);
  if (!review) throw new HttpException(404, "Review not found");
  if (String(review.user) !== req.user!.id && req.user!.role !== "ADMIN") throw new HttpException(403, "You can only delete your own reviews");
  await review.deleteOne();
  await refreshRatings([review.meal]);
  res.json({ success: true, message: "Review deleted" });
});

export default router;
