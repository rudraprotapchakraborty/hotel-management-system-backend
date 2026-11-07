import { Schema, model, Document, Types } from "mongoose";

export interface IMealLike extends Document {
  meal: Types.ObjectId;
  user: Types.ObjectId;
}

const likeSchema = new Schema<IMealLike>({
  meal: { type: Schema.Types.ObjectId, ref: "Meal", required: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
});

// A person can like a meal once
likeSchema.index({ meal: 1, user: 1 }, { unique: true });

export const MealLike = model<IMealLike>("MealLike", likeSchema);
