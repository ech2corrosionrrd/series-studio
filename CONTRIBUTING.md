# Участь у проєкті / Contributing

Дякуємо за інтерес до Series Lab. Нижче коротко, як запустити проєкт, що
перевіряється перед комітом і які правила тут діють.
Short English summary at the end.

## Запуск

Потрібен Node.js 22.13 або новіший.

```
npm ci
npm start
```

Увімкніть хуки в новому клоні:

```
git config core.hooksPath .githooks
```

## Перед комітом

`npm run ci` запускає все одним кроком: тести з порогом покриття `src/`,
`docs:check`, `audit:i18n`, `audit:ui`, `audit:help`, `audit:api`. Усе має бути зеленим.
Хук `pre-push` запускає цю команду сам.

Тест, що падає «іноді», це дефект: його не перезапускають і не ігнорують
(`npm run test:repeat` ганяє тести кілька разів поспіль).

## Документація йде разом із кодом

Коміт, що змінює поведінку без оновлення документів, не приймається.
Таблиця «що змінили, що оновити» — у [CLAUDE.md](CLAUDE.md), розділ
«Документація — до коміту, не після». Коротко:

- CLI-команда чи прапорець: `README.md`, `docs/GUIDE.md`, довідка в `server/ui/locales/*`.
- HTTP-маршрут: `docs/API.md`.
- Змінна `.env`: `README.md`, `.env.example`.
- Будь-що видиме користувачу: рядок під `## [Unreleased]` у `CHANGELOG.md`.

`npm run docs:check` перевіряє розбіжності офлайн.

## Мова і інтерфейс

Видимий текст лежить у `server/ui/locales/uk.js` і `en.js`; змінюйте обидва
файли одночасно (`npm run audit:i18n` стежить за збігом ключів).

## Зображення

На сторінках Series Lab використовуються лише зображення, створені в самому
Series Lab. Чужих, стокових чи сторонніх картинок і шрифтів не додавайте:
сторінки не залежать від стороннього коду.

## Ключі й секрети

Ніколи не комітьте приватні ключі гаманців, API-ключі, токени, `.env` чи
IP-адреси серверів. Push protection у цьому репозиторії блокує відомі типи
секретів, але відповідальність лишається на авторі. Про вразливості пишіть
приватно за [SECURITY.md](SECURITY.md), не в issue.

## Git

- Коміти українською або англійською у стилі `fix:`, `feat:`, `docs:`.
- Нові функції, зміни платежів, ключів, сховища чи схеми даних: гілка від
  `main` і pull request, одна гілка на задачу.
- Дрібні зміни (тексти, документація, конфіги) можна комітити в `main`.
- Force-push у `main` заборонено налаштуваннями репозиторію.

## English summary

Node.js 22.13+, `npm ci`, `npm start`, enable hooks with
`git config core.hooksPath .githooks`. Run `npm run ci` before pushing; it must
be green. Docs must change together with code (see CLAUDE.md), UI strings go
into both `uk.js` and `en.js`, and pages may only use images generated in
Series Lab. Never commit secrets, wallet keys or server addresses; report
vulnerabilities privately via SECURITY.md. Features and anything touching
payments, keys, storage or data schema go through a branch and a pull request.
