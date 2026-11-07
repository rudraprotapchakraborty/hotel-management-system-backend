import { Router, Response } from "express";
import { z } from "zod";
import { AuthRequest, authMiddleware } from "../../core/auth-middleware";
import { HttpException } from "../../core/http-exception";
import { objectIdSchema } from "../../core/object-id";
import { validateRequest } from "../../core/validate-request";
import { CartItem } from "../../models/CartItem";
import { Meal } from "../../models/Meal";
import { Plan } from "../../models/Plan";
import { BADGES, User } from "../../models/User";

const router = Router();
router.use(authMiddleware);

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PricedItem {
  id: string;
  kind: "meal" | "plan";
  ref: string;
  name: string;
  image?: string;
  price: number;
  badge?: string;
}

/**
 * The cart with prices read from the database right now, never from the browser.
 * Items whose meal was removed, taken off the menu, or whose plan is no longer an upgrade are dropped.
 */
export const pricedCart = async (userId: string) => {
  const [items, me] = await Promise.all([CartItem.find({ user: userId }).sort({ createdAt: 1 }), User.findById(userId).select("badge")]);
  const mealIds = items.filter((i) => i.kind === "meal").map((i) => i.ref);
  const planIds = items.filter((i) => i.kind === "plan").map((i) => i.ref);
  const [meals, plans] = await Promise.all([Meal.find({ _id: { $in: mealIds }, upcoming: false }), Plan.find({ _id: { $in: planIds } })]);
  const mealOf = new Map(meals.map((m) => [String(m._id), m]));
  const planOf = new Map(plans.map((p) => [String(p._id), p]));
  const tier = (b?: string) => BADGES.indexOf((b ?? "bronze") as (typeof BADGES)[number]);

  const priced: PricedItem[] = [];
  const stale: string[] = [];
  for (const item of items) {
    if (item.kind === "meal") {
      const m = mealOf.get(String(item.ref));
      if (!m) stale.push(String(item._id));
      else priced.push({ id: String(item._id), kind: "meal", ref: String(m._id), name: m.name, image: m.image, price: m.price });
    } else {
      const p = planOf.get(String(item.ref));
      if (!p || p.price <= 0 || tier(p.badge) <= tier(me?.badge)) stale.push(String(item._id));
      else priced.push({ id: String(item._id), kind: "plan", ref: String(p._id), name: p.name, price: p.price, badge: p.badge });
    }
  }
  if (stale.length) await CartItem.deleteMany({ _id: { $in: stale } });
  return { items: priced, total: round2(priced.reduce((sum, i) => sum + i.price, 0)) };
};

const addSchema = z.object({ body: z.object({ kind: z.enum(["meal", "plan"]), refId: objectIdSchema }) });
const idSchema = z.object({ params: z.object({ id: objectIdSchema }) });

router.get("/", async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await pricedCart(req.user!.id) });
});

router.post("/", validateRequest(addSchema), async (req: AuthRequest, res: Response) => {
  const { kind, refId } = req.body as { kind: "meal" | "plan"; refId: string };
  const userId = req.user!.id;

  if (kind === "meal") {
    const meal = await Meal.findById(refId).select("upcoming");
    if (!meal) throw new HttpException(404, "That meal was not found");
    if (meal.upcoming) throw new HttpException(400, "This meal is not on the menu yet");
  } else {
    const [plan, me] = await Promise.all([Plan.findById(refId), User.findById(userId).select("badge")]);
    if (!plan) throw new HttpException(404, "That plan was not found");
    if (plan.price <= 0) throw new HttpException(400, "The free plan does not need to be bought");
    if (BADGES.indexOf(plan.badge) <= BADGES.indexOf(me?.badge ?? "bronze")) throw new HttpException(400, "You already have this plan or a better one");
    // only one plan can be bought at a time: the new one replaces any other
    await CartItem.deleteMany({ user: userId, kind: "plan", ref: { $ne: plan._id } });
  }

  try {
    await CartItem.create({ user: userId, kind, ref: refId });
  } catch (err: any) {
    if (err?.code !== 11000) throw err; // already in the cart
  }
  res.status(201).json({ success: true, data: await pricedCart(userId) });
});

router.delete("/:id", validateRequest(idSchema), async (req: AuthRequest, res: Response) => {
  await CartItem.deleteOne({ _id: req.params.id, user: req.user!.id });
  res.json({ success: true, data: await pricedCart(req.user!.id) });
});

export default router;
