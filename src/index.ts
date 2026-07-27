import { buildApp } from './app.js';
import { config } from './config.js';

const app = buildApp();

const server = app.listen(config.port, () => {
  console.info({ port: config.port }, 'Customer Profile service started');
});

function shutdown(signal: string): void {
  console.info({ signal }, 'Shutting down Customer Profile service');
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
