import db from "../db.server";

export async function loader() {
  const startTime = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;

    const requiredEnvVars = [
      "DATABASE_URL",
      "SHOPIFY_API_KEY",
    ];

    const missingEnvVars = requiredEnvVars.filter(
      (variableName) => !process.env[variableName]
    );

    if (missingEnvVars.length > 0) {
      return Response.json(
        {
          status: "unhealthy",
          error: `Missing environment variables: ${missingEnvVars.join(", ")}`,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    const responseTime = Date.now() - startTime;

    return Response.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: `${responseTime}ms`,
      environment: process.env.NODE_ENV || "development",
      version: process.env.APP_VERSION || "1.0.0",
    });
  } catch (error) {
    console.error("Health check failed:", error);

    return Response.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
