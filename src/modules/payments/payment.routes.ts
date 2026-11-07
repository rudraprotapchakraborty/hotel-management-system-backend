import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import Stripe from "stripe";
import { z } from "zod";
import { env } from "../../config/env";
import { AuthRequest, authMiddleware } from "../../core/auth-middleware";
import { HttpException } from "../../core/http-exception";
import { objectIdSchema } from "../../core/object-id";
import { validateRequest } from "../../core/validate-request";
import { CartItem } from "../../models/CartItem";
import { IPayment, Payment } from "../../models/Payment";
import { BADGES, User } from "../../models/User";
import { sendMail } from "../../utils/mailer";
import { pricedCart, round2 } from "../cart/cart.routes";

const router = Router();

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
const sslConfigured = Boolean(env.SSL_STORE_ID && env.SSL_STORE_PASSWD);
const sslHost = env.SSL_SANDBOX ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com";

export const shapePayment = (p: IPayment) => ({
  id: String(p._id),
  items: p.items.map((i) => ({ kind: i.kind, name: i.name, image: i.image ?? null, price: i.price, badge: i.badge ?? null })),
  total: p.total,
  method: p.method,
  status: p.status,
  transactionId: p.transactionId,
  paidAt: p.paidAt ?? null,
  createdAt: p.createdAt,
});

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Best-effort receipt. A mail problem never undoes a payment. */
const sendReceipt = async (payment: IPayment) => {
  try {
    const user = await User.findById(payment.user).select("email fullName");
    if (!user) return;
    const lines = payment.items.map((i) => `${i.name}: $${i.price.toFixed(2)}`).join("\n");
    await sendMail({
      to: user.email,
      subject: "Your Hotel Dine receipt",
      text: `Thank you, ${user.fullName}!\n\n${lines}\n\nTotal: $${payment.total.toFixed(2)}\nTransaction: ${payment.transactionId}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto"><h2>Thank you, ${escapeHtml(user.fullName)}!</h2>
        <ul>${payment.items.map((i) => `<li>${escapeHtml(i.name)}: $${i.price.toFixed(2)}</li>`).join("")}</ul>
        <p><b>Total: $${payment.total.toFixed(2)}</b></p><p style="color:#666">Transaction ${escapeHtml(payment.transactionId)}</p></div>`,
    });
  } catch (err) {
    console.error("Receipt email failed", err);
  }
};

/**
 * Marks an order paid exactly once, whichever callback arrives first or however many times it arrives:
 * clears what was bought from the cart, grants a purchased membership and sends the receipt.
 */
const finalize = async (paymentId: string) => {
  const paid = await Payment.findOneAndUpdate({ _id: paymentId, status: "pending" }, { $set: { status: "paid", paidAt: new Date() } }, { returnDocument: "after" });
  if (!paid) return Payment.findById(paymentId); // already finalized
  await CartItem.deleteMany({ user: paid.user, $or: paid.items.map((i) => ({ kind: i.kind, ref: i.ref })) });
  const plan = paid.items.find((i) => i.kind === "plan" && i.badge);
  if (plan?.badge) {
    const me = await User.findById(paid.user).select("badge");
    if (me && BADGES.indexOf(plan.badge as (typeof BADGES)[number]) > BADGES.indexOf(me.badge)) {
      me.badge = plan.badge as (typeof BADGES)[number];
      await me.save();
    }
  }
  void sendReceipt(paid);
  return paid;
};

/** Turns the cart into an order, priced on the server. */
const createOrder = async (userId: string, method: "stripe" | "ssl") => {
  const cart = await pricedCart(userId);
  if (!cart.items.length) throw new HttpException(400, "Your cart is empty");
  if (cart.total < 0.5) throw new HttpException(400, "The order total must be at least $0.50");
  // Older unfinished attempts are cancelled so only one is ever live
  await Payment.updateMany({ user: userId, status: "pending" }, { $set: { status: "cancelled" } });
  return Payment.create({
    user: userId,
    items: cart.items.map((i) => ({ kind: i.kind, ref: new Types.ObjectId(i.ref), name: i.name, image: i.image, price: i.price, badge: i.badge })),
    total: cart.total,
    method,
    transactionId: new Types.ObjectId().toString(),
  });
};

const bdt = (usd: number) => round2(usd * env.SSL_USD_TO_BDT);
const back = (status: string) => `${env.FRONTEND_URL}/dashboard/payments?status=${status}`;

/** Which payment methods are switched on (so the page only offers what works). */
router.get("/config", (_req: Request, res: Response) => {
  res.json({ success: true, data: { stripe: Boolean(stripe), ssl: sslConfigured, usdToBdt: env.SSL_USD_TO_BDT } });
});

const paymentIdSchema = z.object({ body: z.object({ paymentId: objectIdSchema }) });

/** Card payment, step 1: create the order and a Stripe PaymentIntent for it. */
router.post("/stripe/intent", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!stripe) throw new HttpException(503, "Card payments are not configured");
  const payment = await createOrder(req.user!.id, "stripe");
  try {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(payment.total * 100),
      currency: "usd",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { paymentId: String(payment._id), userId: req.user!.id },
    });
    payment.intentId = intent.id;
    await payment.save();
    res.status(201).json({ success: true, data: { paymentId: String(payment._id), clientSecret: intent.client_secret, total: payment.total } });
  } catch (err) {
    payment.status = "failed";
    await payment.save();
    console.error("Stripe intent failed", err);
    throw new HttpException(502, "Could not start the card payment. Please try again.");
  }
});

/** Card payment, step 2: after the card is charged, check with Stripe itself before marking the order paid. */
router.post("/stripe/confirm", authMiddleware, validateRequest(paymentIdSchema), async (req: AuthRequest, res: Response) => {
  if (!stripe) throw new HttpException(503, "Card payments are not configured");
  const payment = await Payment.findOne({ _id: req.body.paymentId, user: req.user!.id, method: "stripe" });
  if (!payment || !payment.intentId) throw new HttpException(404, "Order not found");
  if (payment.status === "paid") return void res.json({ success: true, data: shapePayment(payment) });
  if (payment.status !== "pending") throw new HttpException(400, "This order can no longer be paid");

  const intent = await stripe.paymentIntents.retrieve(payment.intentId);
  if (intent.status !== "succeeded") throw new HttpException(400, "The payment has not gone through");
  if (intent.amount !== Math.round(payment.total * 100) || intent.metadata?.paymentId !== String(payment._id)) {
    throw new HttpException(400, "The payment does not match this order");
  }
  const done = await finalize(String(payment._id));
  res.json({ success: true, data: shapePayment(done!) });
});

/** SSLCommerz: create the order and ask the gateway for a payment page. */
router.post("/ssl/init", authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!sslConfigured) throw new HttpException(503, "SSLCommerz is not configured");
  const [payment, me] = await Promise.all([createOrder(req.user!.id, "ssl"), User.findById(req.user!.id).select("email fullName")]);
  const form = new URLSearchParams({
    store_id: env.SSL_STORE_ID,
    store_passwd: env.SSL_STORE_PASSWD,
    total_amount: bdt(payment.total).toFixed(2),
    currency: "BDT",
    tran_id: payment.transactionId,
    success_url: `${env.BACKEND_URL}/api/payments/ssl/success`,
    fail_url: `${env.BACKEND_URL}/api/payments/ssl/fail`,
    cancel_url: `${env.BACKEND_URL}/api/payments/ssl/cancel`,
    shipping_method: "NO",
    product_name: "Hotel Dine order",
    product_category: "Food",
    product_profile: "general",
    num_of_item: String(payment.items.length),
    cus_name: me?.fullName ?? "Guest",
    cus_email: me?.email ?? "guest@example.com",
    cus_add1: "Dhaka",
    cus_city: "Dhaka",
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: "01700000000",
  });
  try {
    const response = await fetch(`${sslHost}/gwprocess/v4/api.php`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    const json: any = await response.json();
    if (!json?.GatewayPageURL) throw new Error(json?.failedreason || "no gateway url");
    res.status(201).json({ success: true, data: { gatewayUrl: json.GatewayPageURL, paymentId: String(payment._id), totalBdt: bdt(payment.total) } });
  } catch (err) {
    payment.status = "failed";
    await payment.save();
    console.error("SSLCommerz init failed", err);
    throw new HttpException(502, "Could not reach the payment gateway. Please try again.");
  }
});

/** SSLCommerz sends the browser back here after a successful payment. The result is verified with the gateway. */
router.post("/ssl/success", async (req: Request, res: Response) => {
  try {
    const { val_id, tran_id } = (req.body ?? {}) as Record<string, string>;
    const payment = tran_id ? await Payment.findOne({ transactionId: String(tran_id), method: "ssl" }) : null;
    if (!payment || !val_id) return res.redirect(303, back("failed"));
    if (payment.status === "paid") return res.redirect(303, back("success"));
    if (payment.status !== "pending") return res.redirect(303, back("failed"));

    const check = new URLSearchParams({ val_id: String(val_id), store_id: env.SSL_STORE_ID, store_passwd: env.SSL_STORE_PASSWD, format: "json" });
    const response = await fetch(`${sslHost}/validator/api/validationserverAPI.php?${check}`, { signal: AbortSignal.timeout(20_000) });
    const data: any = await response.json();
    const valid = (data?.status === "VALID" || data?.status === "VALIDATED") && data.tran_id === payment.transactionId && Math.abs(Number(data.amount) - bdt(payment.total)) < 1;
    if (!valid) {
      payment.status = "failed";
      await payment.save();
      return res.redirect(303, back("failed"));
    }
    await finalize(String(payment._id));
    res.redirect(303, back("success"));
  } catch (err) {
    console.error("SSLCommerz success handling failed", err);
    res.redirect(303, back("failed"));
  }
});

const closeSsl = (status: "failed" | "cancelled") => async (req: Request, res: Response) => {
  const tranId = String((req.body ?? {}).tran_id ?? "");
  if (tranId) await Payment.updateOne({ transactionId: tranId, method: "ssl", status: "pending" }, { $set: { status } });
  res.redirect(303, back(status));
};
router.post("/ssl/fail", closeSsl("failed"));
router.post("/ssl/cancel", closeSsl("cancelled"));

/** My orders, newest first. */
router.get("/mine", authMiddleware, async (req: AuthRequest, res: Response) => {
  const rows = await Payment.find({ user: req.user!.id, status: { $ne: "pending" } }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, data: rows.map(shapePayment) });
});

export default router;
