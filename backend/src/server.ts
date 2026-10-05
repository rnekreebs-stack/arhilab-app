import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { pool } from './database/pool.js';
const server = createApp().listen(config.PORT, config.HOST, () => logger.info({ port: config.PORT }, 'API listening'));
function shutdown() {
  server.close(() => { void pool.end().then(() => process.exit(0)); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
