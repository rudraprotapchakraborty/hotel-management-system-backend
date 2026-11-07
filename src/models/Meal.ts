import { Schema, model, Document, Types } from "mongoose";

export const MEAL_TYPES = ["breakfast", "soup", "salad", "sandwich", "burger", "pizza", "pasta", "main", "dessert"] as const;
export const MEAL_TIMES = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export type MealTime = (typeof MEAL_TIMES)[number];

export interface IMeal extends Document {
  name: string;
  description: string;
  /** dish family, for filtering */
  type: MealType;
  mealTime: MealTime;
  price: number;
  chef: string;
  image: string;
  ingredients: string[];
  /** Upcoming meals are announced but cannot be ordered until an admin publishes them */
  upcoming: boolean;
  likeCount: number;
  ratingCount: number;
  ratingSum: number;
  postedAt: Date;
  addedBy?: Types.ObjectId;
  /** Sample menu entries; shared test accounts may not change these */
  isSeed: boolean;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
}

const mealSchema = new Schema<IMeal>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    description: { type: String, required: true, trim: true, minlength: 10, maxlength: 600 },
    type: { type: String, enum: MEAL_TYPES, required: true },
    mealTime: { type: String, enum: MEAL_TIMES, required: true },
    price: { type: Number, required: true, min: 0.5, max: 500 },
    chef: { type: String, required: true, trim: true, maxlength: 60 },
    image: { type: String, required: true, trim: true, maxlength: 800 },
    ingredients: { type: [String], default: [] },
    upcoming: { type: Boolean, default: false },
    likeCount: { type: Number, default: 0, min: 0 },
    ratingCount: { type: Number, default: 0, min: 0 },
    ratingSum: { type: Number, default: 0, min: 0 },
    postedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: "User" },
    isSeed: { type: Boolean, default: false },
    source: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

mealSchema.index({ upcoming: 1, likeCount: -1 });
mealSchema.index({ type: 1, mealTime: 1 });
mealSchema.index({ price: 1 });

export const Meal = model<IMeal>("Meal", mealSchema);
