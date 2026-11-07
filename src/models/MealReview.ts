import { Schema, model, Document, Types } from "mongoose";

export interface IMealReview extends Document {
  meal: Types.ObjectId;
  user: Types.ObjectId;
  rating: number;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IMealReview>(
  {
    meal: { type: Schema.Types.ObjectId, ref: "Meal", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
  },
  { timestamps: true }
);

// One review per person per meal (editing replaces it)
reviewSchema.index({ meal: 1, user: 1 }, { unique: true });

export const MealReview = model<IMealReview>("MealReview", reviewSchema);
