"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBAPP_DIR = void 0;
exports.createApp = createApp;
require("reflect-metadata");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const fs_1 = require("fs");
const path_1 = require("path");
const app_module_1 = require("./app.module");
const config_1 = require("./config");
const db_service_1 = require("./db/db.service");
const migrate_1 = require("./db/migrate");
const seed_1 = require("./scripts/seed");
/** Папка с Mini App (taxi-platform/webapp) — сервер раздаёт её по адресу /app/ */
exports.WEBAPP_DIR = process.env.WEBAPP_DIR ?? (0, path_1.join)(__dirname, '..', '..', 'webapp');
/** Создание приложения — общее для запуска сервера и тестов */
async function createApp(opts = {}) {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: opts.logger === false ? false : ['log', 'warn', 'error'],
    });
    app.setGlobalPrefix('api');
    app.enableCors({ origin: true });
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.enableShutdownHooks();
    // за nginx/caddy — чтобы правильно видеть https и IP клиента
    app.set('trust proxy', 1);
    // Проверка «жив ли сервер» для хостингов (BotHost и др. стучатся на /health)
    // и главная страница → диспетчерская (на своём сервере это делает Caddy)
    const http = app.getHttpAdapter().getInstance();
    const alive = (_req, res) => res.json({ ok: true });
    http.get('/health', alive);
    http.get('/healthz', alive);
    http.get('/', (_req, res) => res.redirect(302, '/app/dispatch/'));
    if ((0, fs_1.existsSync)(exports.WEBAPP_DIR)) {
        app.useStaticAssets(exports.WEBAPP_DIR, {
            prefix: '/app/',
            // index.html не кэшируем — обновления приложения видны сразу
            setHeaders: (res, path) => {
                res.setHeader('Cache-Control', path.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
            },
        });
    }
    else if (opts.logger !== false) {
        new common_1.Logger('Taxi').warn(`Папка Mini App не найдена: ${exports.WEBAPP_DIR}`);
    }
    const log = new common_1.Logger('Taxi');
    if (config_1.config.migrateOnStart) {
        await (0, migrate_1.runMigrations)(app.get(db_service_1.DbService).pool, (m) => opts.logger !== false && log.log(m));
    }
    if (config_1.config.demo.seedOnStart) {
        await (0, seed_1.seedDemo)(app.get(db_service_1.DbService).pool, (m) => log.log(m));
    }
    return app;
}
