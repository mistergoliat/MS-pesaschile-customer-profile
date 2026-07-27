import express, { type Express } from 'express';
import { buildRoutes } from './http/routes/index.js';

export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(buildRoutes());
  return app;
}
