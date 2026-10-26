// Точка входа для хостингов, которые запускают Node.js-проект как есть
// (npm install → node index.js). Сервер уже собран в backend/dist
// командой `npm run build:dist` — после изменений в backend/src пересоберите и закоммитьте.
require('./backend/dist/main.js');
