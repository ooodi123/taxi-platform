import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { assertProductionConfig, config } from './config';

async function bootstrap() {
  assertProductionConfig();
  const app = await createApp();
  await app.listen(config.port, '0.0.0.0');
  const log = new Logger('Taxi');
  log.log(`API запущен: http://localhost:${config.port}/api  (сокеты: /socket.io)`);
  if (config.devAuth) log.warn('DEV_AUTH включён — тестовый вход без Telegram. Не используйте это в продакшене.');
}

bootstrap().catch((e) => {
  console.error('Не удалось запустить сервер:', e.message ?? e);
  process.exit(1);
});
