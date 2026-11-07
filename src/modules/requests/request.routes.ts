import { Router, Response } from "express";
import { z } from "zod";
import { AuthRequest, authMiddleware } from "../../core/auth-middleware";
import { HttpException } from "../../core/http-exception";
import { objectIdSchema } from "../../core/object-id";
import { validateRequest } from "../../core/validate-request";
import { Meal } from "../../models/Meal";
import { IMealRequest, MealRequest } from "../../models/MealRequest";

const router = Router();
router.use(authMiddleware);

type Ref<T> = (T & { _id: unknown }) | null;

/** A meal request as the guest or the admin sees it. Exported for the admin routes. */
export const shapeRequest = (r: IMealRequest) => {
  const meal = r.meal as unknown as Ref<{ name: string; image: string; price: number }>;
  const user = r.user as unknown as Ref<{ fullName: string; email: string; profileImageUrl?: string }>;
  return {
    id: String(r._id),
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    meal: meal && "name" in meal ? { id: String(meal._id), name: meal.name, image: meal.image, price: meal.price } : null,
    user: user && "fullName" in user ? { id: String(user._id), name: user.fullName, email: user.email, image: user.profileImageUrl ?? null } : null,
  };
};

export const populateRequest = [
  { path: "meal", select: "name image price" },
  { path: "user", select: "fullName email profileImageUrl" },
];

const createSchema = z.object({ body: z.object({ mealId: objectIdSchema }) });
const idSchema = z.object({ params: z.object({ id: objectIdSchema }) });

/** Ask the kitchen to prepare a meal. */
router.post("/", validateRequest(createSchema), async (req: AuthRequest, res: Response) => {
  const meal = await Meal.findById(req.body.mealId).select("upcoming");
  if (!meal) throw new HttpException(404, "That meal was not found");
  if (meal.upcoming) throw new HttpException(400, "This meal is not on the menu yet");
  try {
    const created = await MealRequest.create({ meal: meal._id, user: req.user!.id });
    await created.populate(populateRequest);
    res.status(201).json({ success: true, data: shapeRequest(created) });
  } catch (err: any) {
    if (err?.code === 11000) throw new HttpException(409, "You already have a request waiting for this meal");
    throw err;
  }
});

router.get("/mine", async (req: AuthRequest, res: Response) => {
  const rows = await MealRequest.find({ user: req.user!.id }).sort({ createdAt: -1 }).populate(populateRequest);
  res.json({ success: true, data: rows.map(shapeRequest) });
});

router.post("/:id/cancel", validateRequest(idSchema), async (req: AuthRequest, res: Response) => {
  const request = await MealRequest.findOne({ _id: req.params.id, user: req.user!.id });
  if (!request) throw new HttpException(404, "Request not found");
  if (request.status !== "PENDING") throw new HttpException(400, "Only a waiting request can be cancelled");
  request.status = "CANCELLED";
  await request.save();
  await request.populate(populateRequest);
  res.json({ success: true, data: shapeRequest(request) });
});

export default router;
