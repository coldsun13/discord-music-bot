#!/usr/bin/env node
import { copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.env.example');

if (existsSync(envPath)) {
  console.log('.env уже есть — не трогаю. Редактируй его: open -e .env');
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error('Нет .env.example');
  process.exit(1);
}

copyFileSync(examplePath, envPath);
console.log('Создал .env из шаблона. Заполни токен и ID: open -e .env');
