import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { buildRoutes, type RouteDependencies } from './http/routes/index.js';
import { classifyErrorForLog } from './observability/classify-error-for-log.js';

export function buildApp(deps: RouteDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(buildRoutes(deps));

  // Fallback for errors outside the profile route's own try/catch (e.g. malformed JSON
  // bodies from express.json()) — no request-scoped context is reliably available here,
  // so this only logs a safe classification. Never error.message/stack, SQL, config or
  // secrets. Response contract stays unchanged.
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error({
      event: 'unhandled_request_error',
      errorType: classifyErrorForLog(error),
    });
    response.status(500).json({ error: 'internal_error' });
  });

  return app;
}
