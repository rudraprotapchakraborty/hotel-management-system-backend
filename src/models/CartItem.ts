import { Schema, model, Document, Types } from "mongoose";

export interface ICartItem extends Document {
  user: Types.ObjectId;
  kind: "meal" | "plan";
  ref: Types.ObjectId;
  createdAt: Date;
}

const cartSchema = new Schema<ICartItem>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["meal", "plan"], required: true },
    ref: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The same item cannot be in a cart twice
cartSchema.index({ user: 1, kind: 1, ref: 1 }, { unique: true });

export const CartItem = model<ICartItem>("CartItem", cartSchema);
