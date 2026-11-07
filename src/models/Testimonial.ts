import { Schema, model, Document } from "mongoose";

export interface ITestimonial extends Document {
  name: string;
  details: string;
  rating: number;
}

const testimonialSchema = new Schema<ITestimonial>({
  name: { type: String, required: true, trim: true },
  details: { type: String, required: true, trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
});

export const Testimonial = model<ITestimonial>("Testimonial", testimonialSchema);
