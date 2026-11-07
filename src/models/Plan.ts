import { Schema, model, Document } from "mongoose";
import { BADGES, Badge } from "./User";

export interface IPlan extends Document {
  name: string;
  badge: Badge;
  price: number;
  description: string;
  features: string[];
}

const planSchema = new Schema<IPlan>({
  name: { type: String, required: true, trim: true },
  badge: { type: String, enum: BADGES, required: true, unique: true },
  price: { type: Number, required: true, min: 0 },
  description: { type: String, default: "" },
  features: { type: [String], default: [] },
});

export const Plan = model<IPlan>("Plan", planSchema);
