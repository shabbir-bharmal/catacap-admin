import express from "express";
import cors from "cors";
import path from "path";
import { testConnection } from "./db.js";
import pool from "./db.js";

import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import dashboardRoutes from "./routes/dashboard.js";
import eventRoutes from "./routes/events.js";
import faqRoutes from "./routes/faqs.js";
import newsRoutes from "./routes/news.js";
import teamRoutes from "./routes/teams.js";
import testimonialRoutes from "./routes/testimonials.js";
import siteConfigRoutes from "./routes/siteConfiguration.js";
import publicEventRoutes from "./routes/publicEvents.js";
import publicSiteConfigRoutes from "./routes/publicSiteConfiguration.js";
import formSubmissionRoutes from "./routes/formSubmission.js";
import adminFormSubmissionRoutes from "./routes/adminFormSubmission.js";
import adminUserRoutes from "./routes/adminUsers.js";
import moduleAccessPermissionRoutes from "./routes/moduleAccessPermission.js";
import transactionHistoryRoutes from "./routes/transactionHistory.js";
import accountHistoryRoutes from "./routes/accountHistory.js";
import financeRoutes from "./routes/finance.js";
import adminGroupRoutes from "./routes/adminGroups.js";
import publicGroupRoutes from "./routes/publicGroups.js";
import adminRecommendationRoutes from "./routes/adminRecommendations.js";
import adminPendingGrantRoutes from "./routes/adminPendingGrants.js";
import adminOtherAssetRoutes from "./routes/adminOtherAssets.js";
import adminEmailTemplateRoutes from "./routes/adminEmailTemplates.js";
import adminDisbursalRequestRoutes from "./routes/adminDisbursalRequests.js";
import adminInvestmentReturnRoutes from "./routes/adminInvestmentReturns.js";
import adminCompletedInvestmentRoutes from "./routes/adminCompletedInvestments.js";
import adminInvestmentRoutes from "./routes/adminInvestment.js";
import recycleBinRoutes from "./routes/recycleBin.js";
import campaignRoutes from "./routes/campaign.js";
import { jwtAuthMiddleware } from "./middleware/jwtAuth.js";
import { Router } from "express";
import { initScheduler } from "./scheduler/index.js";
import adminSchedulerRoutes from "./routes/adminScheduler.js";
import adminSchemaChangesRoutes from "./routes/adminSchemaChanges.js";
import analyticsRoutes from "./routes/analytics.js";
import adminMatchingRoutes from "./routes/adminMatching.js";

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || (isProduction ? "5000" : "8200"), 10);

app.use(cors());
app.use(express.json({ limit: "50mb", strict: false }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/uploads", express.static(path.resolve(process.cwd(), "server", "uploads")));

app.use("/api/userauthentication", authRoutes);
app.use("/api/event", publicEventRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/home", jwtAuthMiddleware, dashboardRoutes);
app.use("/api/admin/event", jwtAuthMiddleware, eventRoutes);
app.use("/api/admin/faq", jwtAuthMiddleware, faqRoutes);
app.use("/api/admin/news", jwtAuthMiddleware, newsRoutes);
app.use("/api/admin/team", jwtAuthMiddleware, teamRoutes);
app.use("/api/admin/testimonial", jwtAuthMiddleware, testimonialRoutes);
app.use("/api/admin/site-configuration", jwtAuthMiddleware, siteConfigRoutes);
app.use("/api/SiteConfiguration", publicSiteConfigRoutes);
app.use("/api/form-submission", formSubmissionRoutes);
app.use("/api/admin/form-submission", jwtAuthMiddleware, adminFormSubmissionRoutes);
app.use("/api/admin/user", jwtAuthMiddleware, adminUserRoutes);
app.use("/api/module-access-permission", jwtAuthMiddleware, moduleAccessPermissionRoutes);
app.use("/api/admin/transaction-history", jwtAuthMiddleware, transactionHistoryRoutes);
app.use("/api/admin/finance", jwtAuthMiddleware, financeRoutes);
app.use("/api/admin/group", jwtAuthMiddleware, adminGroupRoutes);
app.use("/api/admin/recommendation", jwtAuthMiddleware, adminRecommendationRoutes);
app.use("/api/admin/pending-grant", jwtAuthMiddleware, adminPendingGrantRoutes);
app.use("/api/admin/other-asset", jwtAuthMiddleware, adminOtherAssetRoutes);
app.use("/api/admin/email-template", jwtAuthMiddleware, adminEmailTemplateRoutes);
app.use("/api/admin/disbursal-request", jwtAuthMiddleware, adminDisbursalRequestRoutes);
app.use("/api/admin/investment-return", jwtAuthMiddleware, adminInvestmentReturnRoutes);
app.use("/api/admin/completed-investment", jwtAuthMiddleware, adminCompletedInvestmentRoutes);
app.use("/api/admin/investment", jwtAuthMiddleware, adminInvestmentRoutes);
app.use("/api/admin/recycle-bin", jwtAuthMiddleware, recycleBinRoutes);
app.use("/api/admin/scheduler", jwtAuthMiddleware, adminSchedulerRoutes);
app.use("/api/admin/schema-changes", jwtAuthMiddleware, adminSchemaChangesRoutes);
app.use("/api/admin/analytics", jwtAuthMiddleware, analyticsRoutes);
app.use("/api/analytics", jwtAuthMiddleware, analyticsRoutes);
app.use("/api/admin/matching", jwtAuthMiddleware, adminMatchingRoutes);
app.use("/api/Campaign", campaignRoutes);
app.use("/api/Group", publicGroupRoutes);
app.use("/api/AccountBalanceHistory", accountHistoryRoutes);
const usersAliasRouter = Router();
usersAliasRouter.get("/get-all-admin-users", jwtAuthMiddleware, (req, res, next) => {
  req.url = "/get-all-admin-users";
  adminUserRoutes(req, res, next);
});
app.use("/api/Users", usersAliasRouter);

const distPath = path.resolve(process.cwd(), "dist");
app.use(express.static(distPath));

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

const ASSET_EXTENSION_RE = /\.(?:js|mjs|cjs|map|css|json|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|zip|wasm)$/i;

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next();
  }
  const pathname = req.path;
  if (pathname.startsWith("/assets/") || ASSET_EXTENSION_RE.test(pathname)) {
    return res.status(404).type("text/plain").send("Not Found");
  }
  res.sendFile(path.join(distPath, "index.html"), (err) => {
    if (err) next(err);
  });
});

async function start() {
  try {
    await testConnection();
    console.log("Database connection verified.");
  } catch (err) {
    console.error("Failed to connect to database:", err);
    process.exit(1);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    initScheduler();
  });
}

start();
