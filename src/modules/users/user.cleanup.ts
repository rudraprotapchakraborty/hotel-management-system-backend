import { HydratedDocument, Types } from "mongoose";
import { IUser } from "../../models/User";
import { Meal } from "../../models/Meal";
import { MealReview } from "../../models/MealReview";
import { MealLike } from "../../models/MealLike";
import { MealRequest } from "../../models/MealRequest";
import { CartItem } from "../../models/CartItem";

/** Recalculates the stored rating totals of the given meals from their reviews. */
export const refreshRatings = async (mealIds: Array<string | Types.ObjectId>) => {
  for (const raw of mealIds) {
    const id = new Types.ObjectId(String(raw)); // aggregation pipelines do not cast strings
    const ratings = await MealReview.aggregate([{ $match: { meal: id } }, { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: "$rating" } } }]);
    await Meal.updateOne({ _id: id }, { $set: { ratingCount: ratings[0]?.count ?? 0, ratingSum: ratings[0]?.sum ?? 0 } });
  }
};

/**
 * Deletes a member together with their cart, requests, likes and reviews.
 * Payments are kept: they are financial records and stay for the admin's books.
 */
export const deleteUserAndContent = async (user: HydratedDocument<IUser>) => {
  const liked = await MealLike.distinct("meal", { user: user._id });
  const reviewed = await MealReview.distinct("meal", { user: user._id });
  await Promise.all([
    CartItem.deleteMany({ user: user._id }),
    MealRequest.deleteMany({ user: user._id }),
    MealLike.deleteMany({ user: user._id }),
    MealReview.deleteMany({ user: user._id }),
  ]);
  if (liked.length) await Meal.updateMany({ _id: { $in: liked }, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
  await refreshRatings(reviewed);
  await user.deleteOne();
};
