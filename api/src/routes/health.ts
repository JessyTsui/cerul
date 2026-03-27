import { Hono } from "hono";

export function createHealthRouter(): any {
  const router = new Hono();

  router.get("/healthz", (c: any) =>
    c.json({
      status: "ok",
      service: "cerul-api",
      timestamp: new Date().toISOString()
    })
  );

  router.get("/", (c: any) => {
    const config = c.get("config");
    return c.json({
      name: "cerul-api",
      status: "ok",
      environment: config.environment
    });
  });

  router.get("/v1/meta", (c: any) => {
    const config = c.get("config");
    return c.json({
      service: "cerul-api",
      framework: "hono",
      environment: config.environment
    });
  });

  return router;
}
