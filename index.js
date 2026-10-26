// Точка входа для хостингов, которые запускают Node.js-проект как есть (npm install → node index.js).
// Сервер собирается при `npm install` (postinstall) и лежит в backend/dist.
require('./backend/dist/main.js');
