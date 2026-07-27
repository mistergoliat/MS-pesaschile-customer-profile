import { buildApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';
import { logShutdownFailure } from './observability/log-shutdown-failure.js';

const { getCustomerProfile, checkReadiness, shutdown } = bootstrap();
const app = buildApp({ getCustomerProfile, checkReadiness });

const server = app.listen(config.port, () => {
  console.info({ port: config.port }, 'Customer Profile service started');
});

function shutdownServer(signal: string): void {
  console.info({ signal }, 'Shutting down Customer Profile service');
  server.close(() => {
    shutdown()
      .catch(logShutdownFailure)
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdownServer('SIGTERM'));
process.on('SIGINT', () => shutdownServer('SIGINT'));
