import dotenv from "dotenv";
dotenv.config({ quiet: true });

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const NODE_ENV = process.env.NODE_ENV || "development";

const clientOrigins = (process.env.CLIENT_URL || "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean);

export const env = {
  NODE_ENV,
  isProduction: NODE_ENV === "production",
  PORT: Number(process.env.PORT) || 5000,
  MONGODB_URI: required("MONGODB_URI"),
  // Own database, so the portal never shares collections (or indexes) with other apps.
  MONGODB_DB: process.env.MONGODB_DB || "hotel_dine",
  JWT_ACCESS_SECRET: required("JWT_ACCESS_SECRET"),
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || "7d",
  // Comma separated list of allowed browser origins (set this in the host's env for production)
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000",

  // Where people are sent after paying: the first listed origin that is not localhost, else the first one
  FRONTEND_URL: clientOrigins.find((o) => !/localhost|127\.0\.0\.1/.test(o)) ?? clientOrigins[0],

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",

  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  MAIL_FROM: process.env.MAIL_FROM || "",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  CONTACT_EMAIL: process.env.CONTACT_EMAIL || "",

  IMGBB_API_KEY: process.env.IMGBB_API_KEY || "",

  // Card payments (Stripe, test mode keys while developing)
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",

  // SSLCommerz sandbox: pays in BDT, so prices are converted with a fixed, configurable rate
  SSL_STORE_ID: process.env.SSL_STORE_ID || "",
  SSL_STORE_PASSWD: process.env.SSL_STORE_PASSWD || "",
  SSL_SANDBOX: process.env.SSL_SANDBOX !== "false",
  SSL_USD_TO_BDT: Number(process.env.SSL_USD_TO_BDT) || 120,
  // Public address of this API (SSLCommerz sends the browser back here)
  BACKEND_URL: (process.env.BACKEND_URL || "http://localhost:5000").replace(/\/+$/, ""),
};
