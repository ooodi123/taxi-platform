"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const app_factory_1 = require("./app.factory");
const config_1 = require("./config");
async function bootstrap() {
    (0, config_1.assertProductionConfig)();
    const app = await (0, app_factory_1.createApp)();
    await app.listen(config_1.config.port, '0.0.0.0');
    const log = new common_1.Logger('Taxi');
    log.log(`API запущен: http://localhost:${config_1.config.port}/api  (сокеты: /socket.io)`);
    if (config_1.config.devAuth)
        log.warn('DEV_AUTH включён — тестовый вход без Telegram. Не используйте это в продакшене.');
}
bootstrap().catch((e) => {
    console.error('Не удалось запустить сервер:', e.message ?? e);
    process.exit(1);
});
