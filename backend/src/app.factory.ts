import 'reflect-metadata';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { config } from './config';
import { DbService } from './db/db.service';
import { runMigrations } from './db/migrate';
import { seedDemo } from './scripts/seed';

/** Папка с Mini App (taxi-platform/webapp) — сервер раздаёт её по адресу /app/ */
export const WEBAPP_DIR = process.env.WEBAPP_DIR ?? join(__dirname, '..', '..', 'webapp');

/** Создание приложения — общее для запуска сервера и тестов */
export async function createApp(opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: opts.logger === false ? false : ['log', 'warn', 'error'],
  });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  // за nginx/caddy — чтобы правильно видеть https и IP клиента
  app.set('trust proxy', 1);

  // Проверка «жив ли сервер» для хостингов (BotHost и др. стучатся на /health)
  // и главная страница → диспетчерская (на своём сервере это делает Caddy)
  const http = app.getHttpAdapter().getInstance();
  const alive = (_req: any, res: any) => res.json({ ok: true });
  http.get('/health', alive);
  http.get('/healthz', alive);
  http.get('/', (_req: any, res: any) => res.redirect(302, '/app/dispatch/'));

  if (existsSync(WEBAPP_DIR)) {
    app.useStaticAssets(WEBAPP_DIR, {
      prefix: '/app/',
      // index.html не кэшируем — обновления приложения видны сразу
      setHeaders: (res, path) => {
        res.setHeader('Cache-Control', path.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
      },
    });
  } else if (opts.logger !== false) {
    new Logger('Taxi').warn(`Папка Mini App не найдена: ${WEBAPP_DIR}`);
  }

  const log = new Logger('Taxi');
  if (config.migrateOnStart) {
    await runMigrations(app.get(DbService).pool, (m) => opts.logger !== false && log.log(m));
  }
  if (config.demo.seedOnStart) {
    await seedDemo(app.get(DbService).pool, (m) => log.log(m));
  }
  return app;
}
