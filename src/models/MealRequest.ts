import { Schema, model, Document, Types } from "mongoose";

export const REQUEST_STATUSES = ["PENDING", "SERVED", "CANCELLED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface IMealRequest extends Document {
  meal: Types.ObjectId;
  user: Types.ObjectId;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

const requestSchema = new Schema<IMealRequest>(
  {
    meal: { type: Schema.Types.ObjectId, ref: "Meal", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: REQUEST_STATUSES, default: "PENDING" },
  },
  { timestamps: true }
);

// One waiting request per person per meal
requestSchema.index({ meal: 1, user: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" } });
requestSchema.index({ status: 1, createdAt: -1 });

export const MealRequest = model<IMealRequest>("MealRequest", requestSchema);
