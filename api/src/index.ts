import { Hono } from "hono";

import { baseContextMiddleware } from "./middleware/auth";
import { corsMiddleware } from "./middleware/cors";
import { handleError, handleNotFound } from "./middleware/errors";
import { createAdminRouter } from "./routes/admin";
import { createHealthRouter } from "./routes/health";
import { createIndexRouter } from "./routes";
import { createSearchRouter } from "./routes/search";
import { createTrackingRouter } from "./routes/tracking";
import { createUsageRouter } from "./routes/usage";
import { createWebhookRouter } from "./routes/webhooks";
import { createDashboardRouter } from "./routes/dashboard";

const app = new Hono();

app.use("*", baseContextMiddleware());
app.use("*", corsMiddleware());

app.route("/", createHealthRouter());
app.route("/", createTrackingRouter());
app.route("/v1", createSearchRouter());
app.route("/v1", createIndexRouter());
app.route("/v1", createUsageRouter());
app.route("/admin", createAdminRouter());
app.route("/dashboard", createDashboardRouter());
app.route("/webhooks", createWebhookRouter());

app.onError(handleError);
app.notFound(handleNotFound);

export default app;
