/**
 * Health Check Endpoint
 * 
 * Used by Fly.io and monitoring services to check application health
 */

import type { LoaderFunction} from "@remix-run/node";
import { json } from "@remix-run/node";
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const loader: LoaderFunction = async () => {
  const startTime = Date.now();
  
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;
    
    // Check if critical environment variables are set
    const requiredEnvVars = [
      'JWT_SECRET',
      'DATABASE_URL',
      'SHOPIFY_API_KEY',
    ];
    
    const missingEnvVars = requiredEnvVars.filter(
      (varName) => !process.env[varName]
    );
    
    if (missingEnvVars.length > 0) {
      return json(
        {
          status: 'unhealthy',
          error: `Missing environment variables: ${missingEnvVars.join(', ')}`,
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
    
    const responseTime = Date.now() - startTime;
    
    return json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: `${responseTime}ms`,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.APP_VERSION || '1.0.0',
    });
  } catch (error) {
    console.error('Health check failed:', error);
    
    return json(
      {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  } finally {
    await prisma.$disconnect();
  }
};
