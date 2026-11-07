import { Router, Response } from "express";
import { z } from "zod";
import { DEMO_ACCOUNTS } from "../../config/demo";
import { AuthRequest, authMiddleware } from "../../core/auth-middleware";
import { HttpException } from "../../core/http-exception";
import { escapeRegex, objectIdSchema } from "../../core/object-id";
import { requireRole } from "../../core/role-middleware";
import { validateRequest } from "../../core/validate-request";
import { Meal } from "../../models/Meal";
import { MealRequest, REQUEST_STATUSES } from "../../models/MealRequest";
import { MealReview } from "../../models/MealReview";
import { Payment } from "../../models/Payment";
import { User } from "../../models/User";
import { populateRequest, shapeRequest } from "../requests/request.routes";
import { shapePayment } from "../payments/payment.routes";
import { deleteUserAndContent } from "../users/user.cleanup";
import { adminUpdateUserSchema, userIdParamSchema } from "../users/user.types";

const router = Router();
router.use(authMiddleware, requireRole("ADMIN"));

const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

/** A demo admin only ever sees and manages demo accounts, never real members. */
const scope = (req: AuthRequest) => (req.user!.isDemo ? { isDemo: true } : {});

/** The shared login accounts shown on the sign-in page must keep working for everyone. */
const isLockedLogin = (email: string) => DEMO_ACCOUNTS.some((a) => a.email === email);

const loadInScope = async (req: AuthRequest, userId: string) => {
  const target = await User.findOne({ _id: userId, ...scope(req) });
  if (!target) throw new HttpException(404, "User not found");
  return target;
};

router.get("/stats", async (req: AuthRequest, res: Response) => {
  const ids = req.user!.isDemo ? await User.distinct("_id", { isDemo: true }) : null;
  const byUser = ids ? { user: { $in: ids } } : {};
  const [users, members, meals, upcoming, pending, orders, revenue, reviews] = await Promise.all([
    User.countDocuments(scope(req)),
    User.countDocuments({ ...scope(req), badge: { $ne: "bronze" } }),
    Meal.countDocuments({ upcoming: false }),
    Meal.countDocuments({ upcoming: true }),
    MealRequest.countDocuments({ ...byUser, status: "PENDING" }),
    Payment.countDocuments({ ...byUser, status: "paid" }),
    Payment.aggregate([{ $match: { ...byUser, status: "paid" } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    MealReview.countDocuments(byUser),
  ]);
  res.json({ success: true, data: { users, members, meals, upcoming, pendingRequests: pending, orders, revenue: Math.round((revenue[0]?.total ?? 0) * 100) / 100, reviews } });
});

router.get("/users", async (req: AuthRequest, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 10_000);
  const limit = clampInt(req.query.limit, 20, 1, 100);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const filter = {
    ...scope(req),
    ...(q ? { $or: [{ email: new RegExp(escapeRegex(q), "i") }, { fullName: new RegExp(escapeRegex(q), "i") }] } : {}),
  };
  const [rows, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), User.countDocuments(filter)]);
  const spent = await Payment.aggregate([
    { $match: { user: { $in: rows.map((u) => u._id) }, status: "paid" } },
    { $group: { _id: "$user", total: { $sum: "$total" } } },
  ]);
  const spentOf = new Map(spent.map((s) => [String(s._id), Math.round(s.total * 100) / 100]));

  res.json({
    success: true,
    data: {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      users: rows.map((u) => ({
        id: String(u._id),
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        badge: u.badge,
        profileImageUrl: u.profileImageUrl,
        emailVerified: u.emailVerified,
        isBlocked: u.isBlocked,
        isDemo: u.isDemo,
        locked: isLockedLogin(u.email),
        spent: spentOf.get(String(u._id)) ?? 0,
        createdAt: u.createdAt,
      })),
    },
  });
});

router.patch("/users/:userId", validateRequest(adminUpdateUserSchema), async (req: AuthRequest, res: Response) => {
  const userId = req.params.userId as string;
  const target = await loadInScope(req, userId);
  if (userId === req.user!.id && (req.body.isBlocked === true || (req.body.role && req.body.role !== "ADMIN"))) {
    throw new HttpException(400, "You cannot block or demote yourself");
  }
  if (isLockedLogin(target.email)) throw new HttpException(403, "The shared login accounts cannot be blocked or changed.");
  const updated = await User.findByIdAndUpdate(userId, { $set: req.body }, { returnDocument: "after" });
  res.json({ success: true, data: { id: userId, role: updated?.role, badge: updated?.badge, isBlocked: updated?.isBlocked } });
});

router.delete("/users/:userId", validateRequest(userIdParamSchema), async (req: AuthRequest, res: Response) => {
  const userId = req.params.userId as string;
  if (userId === req.user!.id) throw new HttpException(400, "You cannot delete your own account here");
  const target = await loadInScope(req, userId);
  if (target.isDemo) throw new HttpException(403, "Shared test accounts are managed by the seed script");
  await deleteUserAndContent(target);
  res.json({ success: true, message: "User deleted" });
});

// ---- meal requests ----------------------------------------------------------

const requestListSchema = z.object({ query: z.object({ status: z.enum(REQUEST_STATUSES).optional() }) });
const requestIdSchema = z.object({ params: z.object({ id: objectIdSchema }) });

router.get("/requests", validateRequest(requestListSchema), async (req: AuthRequest, res: Response) => {
  const { status } = requestListSchema.parse({ query: req.query }).query;
  const ids = req.user!.isDemo ? await User.distinct("_id", { isDemo: true }) : null;
  const rows = await MealRequest.find({ ...(status && { status }), ...(ids && { user: { $in: ids } }) })
    .sort({ status: 1, createdAt: -1 })
    .limit(200)
    .populate(populateRequest);
  res.json({ success: true, data: rows.map(shapeRequest) });
});

/** The kitchen has served the meal. */
router.post("/requests/:id/serve", validateRequest(requestIdSchema), async (req: AuthRequest, res: Response) => {
  const request = await MealRequest.findById(req.params.id).populate(populateRequest);
  if (!request) throw new HttpException(404, "Request not found");
  const requesterId = String((request.user as unknown as { _id?: unknown } | null)?._id ?? "");
  if (req.user!.isDemo && !(await User.exists({ _id: requesterId, isDemo: true } as Record<string, unknown>))) {
    throw new HttpException(403, "Test accounts can only manage test data.");
  }
  if (request.status !== "PENDING") throw new HttpException(400, "This request has already been handled");
  request.status = "SERVED";
  await request.save();
  res.json({ success: true, data: shapeRequest(request) });
});

// ---- payments ---------------------------------------------------------------

router.get("/payments", async (req: AuthRequest, res: Response) => {
  const page = clampInt(req.query.page, 1, 1, 10_000);
  const limit = clampInt(req.query.limit, 20, 1, 100);
  const ids = req.user!.isDemo ? await User.distinct("_id", { isDemo: true }) : null;
  const filter: Record<string, unknown> = { status: { $ne: "pending" }, ...(ids && { user: { $in: ids } }) };
  const [rows, total] = await Promise.all([Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Payment.countDocuments(filter)]);
  const owners = await User.find({ _id: { $in: rows.map((p) => p.user) } }).select("fullName email");
  const ownerOf = new Map(owners.map((u) => [String(u._id), { name: u.fullName, email: u.email }]));
  res.json({
    success: true,
    data: {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      payments: rows.map((p) => ({ ...shapePayment(p), user: ownerOf.get(String(p.user)) ?? null })),
    },
  });
});

export default router;
