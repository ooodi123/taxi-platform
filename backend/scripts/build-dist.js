#!/usr/bin/env node
/**
 * Сборка backend/src → backend/dist без установки зависимостей проекта:
 * каждый .ts-файл транспилируется отдельно (как Babel/esbuild), с сохранением
 * метаданных декораторов NestJS. Нужна для хостингов, которые сами не собирают
 * TypeScript (BotHost и т. п.): готовая папка dist коммитится в репозиторий.
 *
 *   node backend/scripts/build-dist.js            # typescript из backend/node_modules
 *   TS_PATH=/путь/к/typescript node backend/scripts/build-dist.js
 *
 * Полноценная сборка с проверкой типов: cd backend && npm run build
 */
const fs = require('fs');
const path = require('path');

const ts = require(process.env.TS_PATH || require.resolve('typescript', { paths: [path.join(__dirname, '..')] }));
const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'dist');

const options = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  esModuleInterop: true,
  sourceMap: false,
};

fs.rmSync(OUT, { recursive: true, force: true });
let count = 0;
const errors = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) { walk(file); continue; }
    if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
    const res = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: options, fileName: file, reportDiagnostics: true });
    for (const d of res.diagnostics || []) errors.push(`${path.relative(SRC, file)}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    const out = path.join(OUT, path.relative(SRC, file)).replace(/\.ts$/, '.js');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, res.outputText);
    count++;
  }
})(SRC);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Собрано файлов: ${count} → ${path.relative(process.cwd(), OUT)}`);
