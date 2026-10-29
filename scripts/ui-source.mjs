// Увесь код сторінки студії одним рядком: app.js і модулі app-*.js, на які його розрізано.
// Тести й аудити, що шукають шаблони в коді інтерфейсу, читають його звідси, а не з одного файлу.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const UI = join(fileURLToPath(new URL("..", import.meta.url)), "server", "ui");

export function uiFiles() {
  return readdirSync(UI).filter((f) => f === "app.js" || /^app-.+\.js$/.test(f)).sort((a, b) => (a === "app.js" ? -1 : b === "app.js" ? 1 : a.localeCompare(b)));
}

export function readUiSource() {
  return uiFiles().map((f) => readFileSync(join(UI, f), "utf8")).join("\n");
}
