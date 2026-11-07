/**
 * Fills the Hotel database with a sample menu, membership plans and demo accounts.
 *
 *   npm run seed          create / refresh the demo data
 *   npm run seed:clear    remove it again
 *
 * The menu comes from scripts/meals.seed.json: 25 dishes with free-licensed photos from Wikipedia.
 * Plans and testimonials keep the wording of the first version of the site. Only accounts flagged
 * `isDemo` (and the cart, requests, likes, reviews and orders that belong to them), plus the sample
 * menu itself, are ever touched, so real members and their meals are never affected.
 * Safe to run repeatedly: the demo data is reset each time.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Types } from "mongoose";
import { connectDB, disconnectDB } from "../src/config/db";
import { env } from "../src/config/env";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../src/config/demo";
import { hashPassword } from "../src/utils/password";
import { User } from "../src/models/User";
import { Meal } from "../src/models/Meal";
import { MealLike } from "../src/models/MealLike";
import { MealReview } from "../src/models/MealReview";
import { MealRequest } from "../src/models/MealRequest";
import { CartItem } from "../src/models/CartItem";
import { Payment } from "../src/models/Payment";
import { Plan } from "../src/models/Plan";
import { Testimonial } from "../src/models/Testimonial";
import { refreshRatings } from "../src/modules/users/user.cleanup";

const read = (file: string) => JSON.parse(readFileSync(join(__dirname, file), "utf8"));
const meals: any[] = read("meals.seed.json");
const plans: any[] = read("plans.seed.json");
const testimonials: any[] = read("testimonials.seed.json");

const portrait = (g: "men" | "women", n: number) => `https://randomuser.me/api/portraits/${g}/${n}.jpg`;
const hour = 60 * 60 * 1000;
const day = 24 * hour;

type Badge = "bronze" | "silver" | "gold" | "platinum";
const people: { key: string; email: string; fullName: string; role: "ADMIN" | "USER"; badge: Badge; image: string }[] = [
  { key: "admin", email: DEMO_ACCOUNTS[0].email, fullName: "Aria Admin", role: "ADMIN", badge: "platinum", image: portrait("women", 65) },
  { key: "user", email: DEMO_ACCOUNTS[1].email, fullName: "Maya Fernandez", role: "USER", badge: "bronze", image: portrait("women", 44) },
  { key: "tariq", email: "tariq.rahman@hoteldine.demo", fullName: "Tariq Rahman", role: "USER", badge: "gold", image: portrait("men", 32) },
  { key: "noah", email: "noah.lindqvist@hoteldine.demo", fullName: "Noah Lindqvist", role: "USER", badge: "silver", image: portrait("men", 75) },
  { key: "lena", email: "lena.fischer@hoteldine.demo", fullName: "Lena Fischer", role: "USER", badge: "bronze", image: portrait("women", 21) },
];

// [who, meal, rating, comment]
const reviews: [string, string, number, string][] = [
  ["user", "Margherita Pizza", 5, "Thin, blistered crust and proper basil. Easily the best pizza I have had in a hotel."],
  ["tariq", "Margherita Pizza", 5, "Simple and perfect. We ordered a second one."],
  ["noah", "Margherita Pizza", 4, "Great flavour, a little too much cheese for my taste."],
  ["lena", "Gourmet Cheeseburger", 5, "Juicy, and the brioche bun held up to the very last bite."],
  ["tariq", "Gourmet Cheeseburger", 4, "Excellent burger. The fries could be crispier."],
  ["user", "Spaghetti Carbonara", 5, "Rich, peppery and no cream. Exactly how it should be."],
  ["noah", "Spaghetti Carbonara", 5, "Authentic, silky sauce. I would order it every night."],
  ["lena", "Chocolate Lava Cake", 5, "The centre really does flow. Dessert of the trip."],
  ["tariq", "Chocolate Lava Cake", 4, "Lovely, but share it, it is very rich."],
  ["user", "Caesar Salad", 4, "Fresh and crisp with a good dressing."],
  ["lena", "Minestrone Soup", 4, "Warming and full of vegetables. Perfect on a cold evening."],
  ["noah", "Fluffy Pancake Stack", 5, "Fluffy, warm and not too sweet. A great start to the day."],
  ["user", "Tiramisu", 5, "Light, coffee-forward and just the right size."],
  ["tariq", "Grilled Ribeye Steak", 5, "Cooked exactly medium-rare as I asked. The garlic butter is superb."],
  ["lena", "Vegetable Biryani", 4, "Fragrant and generous. A touch more spice would make it perfect."],
  ["noah", "Fish and Chips", 4, "Light batter, proper chips. Good value."],
];

const likesOf: Record<string, string[]> = {
  user: ["Margherita Pizza", "Chocolate Lava Cake", "Tiramisu"],
  tariq: ["Grilled Ribeye Steak", "Gourmet Cheeseburger", "Avocado Toast", "Truffle Mushroom Risotto"],
  noah: ["Chicken Noodle Soup", "Spaghetti Carbonara"],
  admin: ["Margherita Pizza"],
};

const clear = async () => {
  const demo = await User.find({ isDemo: true }).select("_id");
  const ids = demo.map((u) => u._id);
  const demoMeals = await Meal.distinct("_id", { $or: [{ isSeed: true }, { addedBy: { $in: ids } }] });
  const reviewed = await MealReview.distinct("meal", { user: { $in: ids } });
  const [carts, likes, reviewsGone, requests, payments, mealsGone] = await Promise.all([
    CartItem.deleteMany({ $or: [{ user: { $in: ids } }, { kind: "meal", ref: { $in: demoMeals } }] }),
    MealLike.deleteMany({ $or: [{ user: { $in: ids } }, { meal: { $in: demoMeals } }] }),
    MealReview.deleteMany({ $or: [{ user: { $in: ids } }, { meal: { $in: demoMeals } }] }),
    MealRequest.deleteMany({ $or: [{ user: { $in: ids } }, { meal: { $in: demoMeals } }] }),
    Payment.deleteMany({ user: { $in: ids } }),
    Meal.deleteMany({ _id: { $in: demoMeals } }),
  ]);
  // Real members' likes and ratings on demo meals disappear with those meals; ratings of other meals are refreshed
  await refreshRatings(reviewed.filter((m) => !demoMeals.some((d) => String(d) === String(m))));
  const users = await User.deleteMany({ isDemo: true });
  console.log(
    `Removed ${users.deletedCount} demo accounts, ${mealsGone.deletedCount} meals, ${reviewsGone.deletedCount} reviews, ${likes.deletedCount} likes, ${requests.deletedCount} requests, ${payments.deletedCount} orders, ${carts.deletedCount} cart items.`
  );
};

const seed = async () => {
  await clear();
  const password = await hashPassword(DEMO_PASSWORD);

  const users: Record<string, InstanceType<typeof User>> = {};
  for (const p of people) {
    users[p.key] = (await User.findOneAndUpdate(
      { email: p.email },
      { $set: { fullName: p.fullName, role: p.role, badge: p.badge, profileImageUrl: p.image, emailVerified: true, isBlocked: false, isDemo: true, password } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    )) as InstanceType<typeof User>;
  }

  for (const plan of plans) await Plan.updateOne({ badge: plan.badge }, { $set: plan }, { upsert: true });
  await Testimonial.deleteMany({});
  await Testimonial.insertMany(testimonials);

  const docs = meals.map((m, i) => ({
    name: m.name,
    description: m.description,
    type: m.type,
    mealTime: m.mealTime,
    price: m.price,
    chef: m.chef,
    image: m.image,
    ingredients: m.ingredients,
    upcoming: m.upcoming,
    likeCount: m.likes,
    source: m.source,
    isSeed: true,
    postedAt: new Date(Date.now() - (meals.length - i) * 2 * day),
  }));
  const inserted = await Meal.insertMany(docs);
  const byName = new Map(inserted.map((m) => [m.name, m]));
  const get = (name: string) => {
    const m = byName.get(name);
    if (!m) throw new Error(`seed meal missing: ${name}`);
    return m;
  };

  // Likes by the demo members (on top of each meal's sample like count)
  const likeRows = Object.entries(likesOf).flatMap(([who, names]) => names.map((n) => ({ meal: get(n)._id, user: users[who]._id })));
  await MealLike.insertMany(likeRows);
  for (const row of likeRows) await Meal.updateOne({ _id: row.meal }, { $inc: { likeCount: 1 } });

  await MealReview.insertMany(reviews.map(([who, meal, rating, comment], i) => ({ meal: get(meal)._id, user: users[who]._id, rating, comment, createdAt: new Date(Date.now() - (i + 1) * 5 * hour) })));
  await refreshRatings([...new Set(reviews.map(([, meal]) => String(get(meal)._id)))]);

  // Meal requests: some waiting, one already served
  const ask = (who: string, meal: string, status: "PENDING" | "SERVED", ago: number) => ({ meal: get(meal)._id, user: users[who]._id, status, createdAt: new Date(Date.now() - ago * hour) });
  await MealRequest.insertMany([
    ask("user", "Gourmet Cheeseburger", "PENDING", 2),
    ask("user", "Chocolate Lava Cake", "SERVED", 30),
    ask("tariq", "Spaghetti Carbonara", "PENDING", 1),
    ask("noah", "Grilled Ribeye Steak", "PENDING", 3),
    ask("lena", "Fluffy Pancake Stack", "SERVED", 26),
  ]);

  // Paid orders, so the history pages and the admin numbers are not empty
  const order = (who: string, names: string[], method: "stripe" | "ssl", ago: number, plan?: string) => {
    const items = names.map((n) => ({ kind: "meal" as const, ref: get(n)._id, name: n, image: get(n).image, price: get(n).price }));
    const bought = plan ? plans.find((p) => p.badge === plan) : undefined;
    if (bought) items.push({ kind: "plan" as never, ref: new Types.ObjectId(), name: bought.name, image: undefined as never, price: bought.price, badge: bought.badge } as never);
    const total = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
    return {
      user: users[who]._id,
      items,
      total,
      method,
      status: "paid" as const,
      transactionId: new Types.ObjectId().toString(),
      paidAt: new Date(Date.now() - ago * hour),
      createdAt: new Date(Date.now() - ago * hour),
    };
  };
  await Payment.insertMany([
    order("user", ["Margherita Pizza", "Caesar Salad"], "stripe", 70),
    order("user", ["Tiramisu"], "ssl", 40),
    order("tariq", ["Grilled Ribeye Steak", "Gourmet Cheeseburger"], "stripe", 60, "gold"),
    order("noah", ["Spaghetti Carbonara"], "stripe", 52, "silver"),
    order("lena", ["Fluffy Pancake Stack", "Chocolate Lava Cake"], "ssl", 28),
  ]);

  // The demo guest has a couple of things waiting in the cart
  await CartItem.insertMany([
    { user: users.user._id, kind: "meal", ref: get("Spaghetti Carbonara")._id },
    { user: users.user._id, kind: "meal", ref: get("Crème Brûlée")._id },
  ]);

  console.log(`Seeded ${people.length} demo accounts, ${inserted.length} meals (${meals.filter((m) => m.upcoming).length} upcoming), ${plans.length} plans, ${reviews.length} reviews and 5 orders into "${env.MONGODB_DB}".`);
  console.log(`Demo password: ${DEMO_PASSWORD}`);
};

(async () => {
  await connectDB();
  if (process.argv[2] === "clear") await clear();
  else await seed();
  await disconnectDB();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
