import { Schema, model, Document, Types } from "mongoose";

export interface IPaymentItem {
  kind: "meal" | "plan";
  ref: Types.ObjectId;
  name: string;
  image?: string;
  /** price in USD when the order was placed */
  price: number;
  /** for plans, the badge it grants */
  badge?: string;
}

export interface IPayment extends Document {
  user: Types.ObjectId;
  items: IPaymentItem[];
  /** USD total, calculated on the server from current prices */
  total: number;
  method: "stripe" | "ssl";
  status: "pending" | "paid" | "failed" | "cancelled";
  transactionId: string;
  /** Stripe PaymentIntent id */
  intentId?: string;
  paidAt?: Date;
  createdAt: Date;
}

const itemSchema = new Schema<IPaymentItem>(
  {
    kind: { type: String, enum: ["meal", "plan"], required: true },
    ref: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    image: String,
    price: { type: Number, required: true },
    badge: String,
  },
  { _id: false }
);

const paymentSchema = new Schema<IPayment>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [itemSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ["stripe", "ssl"], required: true },
    status: { type: String, enum: ["pending", "paid", "failed", "cancelled"], default: "pending" },
    transactionId: { type: String, required: true, unique: true },
    intentId: { type: String, index: true, sparse: true },
    paidAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

paymentSchema.index({ status: 1, createdAt: -1 });

export const Payment = model<IPayment>("Payment", paymentSchema);
