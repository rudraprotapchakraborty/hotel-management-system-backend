import { Router, Request, Response } from "express";
import { z } from "zod";
import { AuthRequest, authMiddleware, optionalAuth } from "../../core/auth-middleware";
import { HttpException } from "../../core/http-exception";
import { escapeRegex, objectIdSchema } from "../../core/object-id";
import { requireRole } from "../../core/role-middleware";
import { validateRequest } from "../../core/validate-request";
import { CartItem } from "../../models/CartItem";
import { IMeal, MEAL_TIMES, MEAL_TYPES, Meal } from "../../models/Meal";
import { MealLike } from "../../models/MealLike";
import { MealRequest } from "../../models/MealRequest";
import { MealReview } from "../../models/MealReview";
import { User } from "../../models/User";

const router = Router();

const MAX_DEMO_MEALS = 10;

/** What the public may see about a meal. `liked` is only filled in for signed-in people. */
export const shapeMeal = (m: IMeal, liked?: boolean) => ({
  id: String(m._id),
  name: m.name,
  description: m.description,
  type: m.type,
  mealTime: m.mealTime,
  price: m.price,
  chef: m.chef,
  image: m.image,
  ingredients: m.ingredients,
  upcoming: m.upcoming,
  likes: m.likeCount,
  rating: m.ratingCount ? Math.round((m.ratingSum / m.ratingCount) * 10) / 10 : null,
  ratingCount: m.ratingCount,
  postedAt: m.postedAt,
  isSeed: m.isSeed,
  source: m.source ?? null,
  ...(liked === undefined ? {} : { liked }),
});

const imageUrl = z.url({ protocol: /^https?$/ }).max(800, "That link is too long");
const mealFields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().trim().min(10, "Description must be at least 10 characters").max(600),
  type: z.enum(MEAL_TYPES),
  mealTime: z.enum(MEAL_TIMES),
  price: z.coerce.number().min(0.5, "Price must be at least 0.50").max(500),
  chef: z.string().trim().min(2).max(60),
  image: imageUrl,
  ingredients: z.array(z.string().trim().min(1).max(40)).max(20),
  upcoming: z.boolean(),
};

const createSchema = z.object({ body: z.object({ ...mealFields, ingredients: mealFields.ingredients.default([]), upcoming: mealFields.upcoming.default(false) }) });
const updateSchema = z.object({ params: z.object({ id: objectIdSchema }), body: z.object(mealFields).partial() });
const idSchema = z.object({ params: z.object({ id: objectIdSchema }) });

const listSchema = z.object({
  query: z.object({
    q: z.string().trim().max(80).optional(),
    type: z.enum(MEAL_TYPES).optional(),
    mealTime: z.enum(MEAL_TIMES).optional(),
    minPrice: z.coerce.number().min(0).max(500).optional(),
    maxPrice: z.coerce.number().min(0).max(500).optional(),
    sort: z.enum(["popular", "rating", "price-asc", "price-desc", "newest"]).optional(),
    upcoming: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    limit: z.coerce.number().int().min(1).max(48).optional(),
  }),
});

const SORTS = {
  popular: { likeCount: -1, ratingCount: -1 },
  rating: { ratingSum: -1 },
  "price-asc": { price: 1 },
  "price-desc": { price: -1 },
  newest: { postedAt: -1 },
} as const;

const likedSet = async (req: AuthRequest, meals: IMeal[]) => {
  if (!req.user || !meals.length) return new Set<string>();
  const ids = await MealLike.distinct("meal", { user: req.user.id, meal: { $in: meals.map((m) => m._id) } });
  return new Set(ids.map(String));
};

/** Public: the menu. Upcoming meals are listed separately (upcoming=true). */
router.get("/", optionalAuth, validateRequest(listSchema), async (req: AuthRequest, res: Response) => {
  const { q, type, mealTime, minPrice, maxPrice, sort, upcoming = "false", page = 1, limit = 12 } = listSchema.parse({ query: req.query }).query;
  const onlyUpcoming = upcoming === "true";
  const filter: Record<string, unknown> = { upcoming: onlyUpcoming };
  if (q) filter.name = new RegExp(escapeRegex(q), "i");
  if (type) filter.type = type;
  if (mealTime) filter.mealTime = mealTime;
  if (minPrice !== undefined || maxPrice !== undefined) filter.price = { ...(minPrice !== undefined && { $gte: minPrice }), ...(maxPrice !== undefined && { $lte: maxPrice }) };
  const order = SORTS[sort ?? (onlyUpcoming ? "popular" : "newest")] as Record<string, 1 | -1>;

  const [rows, total] = await Promise.all([Meal.find(filter).sort(order).skip((page - 1) * limit).limit(limit), Meal.countDocuments(filter)]);
  const liked = await likedSet(req, rows);
  if (!req.user) res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=60");
  res.json({ success: true, data: { meals: rows.map((m) => shapeMeal(m, req.user ? liked.has(String(m._id)) : undefined)), total, page, pages: Math.max(1, Math.ceil(total / limit)) } });
});

router.get("/featured", async (_req: Request, res: Response) => {
  const rows = await Meal.find({ upcoming: false }).sort({ likeCount: -1, ratingSum: -1 }).limit(6);
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  res.json({ success: true, data: rows.map((m) => shapeMeal(m)) });
});

router.get("/types", async (_req: Request, res: Response) => {
  const rows = await Meal.aggregate([{ $match: { upcoming: false } }, { $group: { _id: "$type", count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  res.json({ success: true, data: rows.map((r) => ({ type: r._id, count: r.count })) });
});

router.get("/:id", optionalAuth, validateRequest(idSchema), async (req: AuthRequest, res: Response) => {
  const meal = await Meal.findById(req.params.id);
  if (!meal) throw new HttpException(404, "That meal was not found");
  const liked = req.user ? Boolean(await MealLike.exists({ meal: meal._id, user: req.user.id })) : undefined;
  res.json({ success: true, data: shapeMeal(meal, liked) });
});

/** Likes: one per person. Upcoming meals can only be liked by members above the free tier. */
router.post("/:id/like", authMiddleware, validateRequest(idSchema), async (req: AuthRequest, res: Response) => {
  const meal = await Meal.findById(req.params.id);
  if (!meal) throw new HttpException(404, "That meal was not found");
  if (meal.upcoming) {
    const me = await User.findById(req.user!.id).select("badge");
    if (!me || me.badge === "bronze") throw new HttpException(403, "Upcoming meals can be liked by Silver, Gold and Platinum members.");
  }
  const existing = await MealLike.findOneAndDelete({ meal: meal._id, user: req.user!.id });
  let delta = existing ? -1 : 0;
  if (!existing) {
    try {
      await MealLike.create({ meal: meal._id, user: req.user!.id });
      delta = 1;
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // a double click: the like already exists
    }
  }
  const fresh = delta
    ? await Meal.findOneAndUpdate({ _id: meal._id }, { $inc: { likeCount: delta } }, { returnDocument: "after" })
    : meal;
  res.json({ success: true, data: { liked: !existing, likes: Math.max(0, fresh?.likeCount ?? 0) } });
});

// ---- admin: manage the menu -------------------------------------------------

const admin = [authMiddleware, requireRole("ADMIN")] as const;

/** Shared test accounts may not change the sample menu; a real admin may change anything. */
const loadManageable = async (req: AuthRequest, id: string) => {
  const meal = await Meal.findById(id);
  if (!meal) throw new HttpException(404, "That meal was not found");
  if (req.user!.isDemo && meal.isSeed) throw new HttpException(403, "Test accounts cannot change the sample menu. Add a meal of your own to try this.");
  return meal;
};

router.post("/", ...admin, validateRequest(createSchema), async (req: AuthRequest, res: Response) => {
  if (req.user!.isDemo && (await Meal.countDocuments({ addedBy: req.user!.id, isSeed: false })) >= MAX_DEMO_MEALS) {
    throw new HttpException(400, `Test accounts can add up to ${MAX_DEMO_MEALS} meals. Delete one to add another.`);
  }
  const meal = await Meal.create({ ...req.body, addedBy: req.user!.id });
  res.status(201).json({ success: true, data: shapeMeal(meal) });
});

router.patch("/:id", ...admin, validateRequest(updateSchema), async (req: AuthRequest, res: Response) => {
  const meal = await loadManageable(req, req.params.id as string);
  meal.set(req.body);
  await meal.save();
  res.json({ success: true, data: shapeMeal(meal) });
});

/** Moves an upcoming meal onto the menu so it can be ordered. */
router.post("/:id/publish", ...admin, validateRequest(idSchema), async (req: AuthRequest, res: Response) => {
  const meal = await loadManageable(req, req.params.id as string);
  if (!meal.upcoming) throw new HttpException(400, "This meal is already on the menu");
  meal.upcoming = false;
  meal.postedAt = new Date();
  await meal.save();
  res.json({ success: true, data: shapeMeal(meal) });
});

router.delete("/:id", ...admin, validateRequest(idSchema), async (req: AuthRequest, res: Response) => {
  const meal = await loadManageable(req, req.params.id as string);
  await Promise.all([
    MealLike.deleteMany({ meal: meal._id }),
    MealReview.deleteMany({ meal: meal._id }),
    MealRequest.deleteMany({ meal: meal._id }),
    CartItem.deleteMany({ kind: "meal", ref: meal._id }),
    meal.deleteOne(),
  ]);
  res.json({ success: true, message: "Meal deleted" });
});

export default router;
