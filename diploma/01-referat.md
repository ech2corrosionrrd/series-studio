# РЕФЕРАТ

Дипломна робота: [N] с., [N] рис., [N] табл., [N] додатків, [N] джерел.

**Об'єкт дослідження** — процес створення колекції цифрових активів (NFT) з відтворюваним набором унікальних зображень і її підготовки до публічного випуску в мережі Solana.

**Предмет дослідження** — методи й програмні засоби детермінованої генерації описів (рецептів) елементів колекції, автоматичної перевірки готовності архіву, безпечної оплати послуг у стабільній монеті без передачі приватних ключів на сервер.

**Мета роботи** — розробити веб-систему Series Lab, що проводить автора колекції від базового зображення до перевіреного архіву й набору для випуску, не приймаючи й не зберігаючи його приватні ключі.

**Методи дослідження:** системний аналіз і порівняння аналогів; об'єктно-орієнтоване й модульне проєктування; детерміновані псевдовипадкові генератори (FNV-1a, mulberry32); хешування SHA-256; автоматизоване тестування (372 тести); безперервна інтеграція; контейнеризація.

**Отримані результати.** Створено систему на Node.js (версія 1.8.0) із 6 залежностями часу виконання: браузерна майстерня з вкладками Огляд, Основа, Конструктор, Рецепти, Генерація, Відбір, Експорт, Деплой, Маркет, Адмін, Довідка; консольний інтерфейс із 23 командами; HTTP-API із 92 маршрутами; публічний режим із входом підписом гаманця (EIP-4361, Phantom), кредитами й оплатою USDC у Solana без посередника; шлях випуску `release-init → upload → hidden → guards → mint → reveal → verify` з локальним підписом. Якість підтверджено 372 автоматичними тестами, перевіркою узгодженості документації з кодом та інтерфейсних перекладів (1550 ключів, українська й англійська).

**Практичне значення.** Система розгорнута як сервіс і може використовуватися авторами колекцій без технічної підготовки; її архітектурні рішення (детермінізм, ворота перевірки, відсутність ключів на сервері) придатні для інших систем випуску цифрових активів.

**Ключові слова:** NFT, ГЕНЕРАЦІЯ КОЛЕКЦІЇ, ДЕТЕРМІНОВАНИЙ ГЕНЕРАТОР, SOLANA, CORE CANDY MACHINE, ARWEAVE, USDC, SQLITE, NODE.JS, ВЕБ-СИСТЕМА.

---

# ABSTRACT

Diploma thesis: [N] pp., [N] figures, [N] tables, [N] appendices, [N] references.

**Object of research:** the process of creating a collection of digital assets (NFTs) with a reproducible set of unique images and preparing it for public release on Solana.

**Subject of research:** methods and software for deterministic generation of collection item descriptions (recipes), automatic readiness checks of the release archive, and safe payment for services in a stablecoin without sending private keys to the server.

**Purpose:** to develop the web system Series Lab, which leads a collection author from a base image to a verified archive and a release kit without ever accepting or storing the author's private keys.

**Methods:** systems analysis and comparison of analogues; modular design; deterministic pseudo-random generators (FNV-1a, mulberry32); SHA-256 hashing; automated testing (372 tests); continuous integration; containerisation.

**Results.** A Node.js system (version 1.8.0, six runtime dependencies) has been built: a browser studio (Overview, Base, Constructor, Recipes, Generate, Review, Export, Deploy, Market, Admin, Help), a command-line interface with 23 commands, an HTTP API with 92 routes, a public mode with wallet-signature sign-in (EIP-4361, Phantom), credits and direct USDC payments on Solana, and a release path `release-init → upload → hidden → guards → mint → reveal → verify` signed locally. Quality is backed by 372 automated tests and consistency checks of documentation against code and of interface translations (1550 keys, Ukrainian and English).

**Practical value.** The system is deployed as a service and can be used by collection authors without technical background; its design decisions (determinism, verification gates, no keys on the server) apply to other digital-asset release systems.

**Keywords:** NFT, COLLECTION GENERATION, DETERMINISTIC GENERATOR, SOLANA, CORE CANDY MACHINE, ARWEAVE, USDC, SQLITE, NODE.JS, WEB SYSTEM.
