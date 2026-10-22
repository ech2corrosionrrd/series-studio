# Політика безпеки / Security policy

## Як повідомити про вразливість

Не відкривайте публічний issue. Скористайтеся приватним повідомленням:
**Security → Report a vulnerability** у цьому репозиторії
(https://github.com/ech2corrosionrrd/series-studio/security/advisories/new).

Опишіть, що знайдено, як відтворити і яку версію (`package.json`) перевіряли.
Приватні ключі гаманців і секрети в повідомлення не додавайте: Series Lab
їх ніколи не потребує.

## Reporting a vulnerability

Please do not open a public issue. Use **Security → Report a vulnerability**
in this repository
(https://github.com/ech2corrosionrrd/series-studio/security/advisories/new).
Describe what you found, how to reproduce it and which version
(`package.json`) you tested. Never include wallet private keys or secrets.

## Що вважається вразливістю / Scope

- обхід входу чи сесії, доступ до чужих даних;
- викрадення або підміна кредитів, платежів, ключів;
- XSS, CSRF, SSRF, виконання коду на сервері;
- витік секретів з коду, образу чи відповідей API.

Ключі приватних гаманців не передаються в Lab і на сервер; підпис і оплата
виконуються на пристрої користувача.
