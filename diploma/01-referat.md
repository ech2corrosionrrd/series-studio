# РЕФЕРАТ

Дипломна робота: 75 с., 21 рис., 62 табл., 8 додатків, 28 джерел.

**Об'єкт дослідження** — процес створення колекції цифрових активів (NFT) з відтворюваним набором унікальних зображень і її підготовки до публічного випуску в мережі Solana.

**Предмет дослідження** — методи й програмні засоби детермінованої генерації описів (рецептів) елементів колекції, автоматичної перевірки готовності архіву, безпечної оплати послуг у стабільній монеті без передачі приватних ключів на сервер.

**Мета роботи** — розробити веб-сайт (веб-систему) зі створення NFT-зображень для блокчейну (на базі комплексу Series Lab), що проводить автора колекції від базового зображення до перевіреного архіву й набору для випуску, не приймаючи й не зберігаючи його приватні ключі.

**Методи дослідження:** системний аналіз і порівняння аналогів; об'єктно-орієнтоване й модульне проєктування; детерміновані псевдовипадкові генератори (FNV-1a, mulberry32); хешування SHA-256; автоматизоване тестування (457 тестів); безперервна інтеграція; контейнеризація.

**Отримані результати.** Створено систему на Node.js (версія 1.9.0) із 6 залежностями часу виконання: браузерна майстерня з вкладками Огляд, Основа, Конструктор, Рецепти, Генерація, Відбір, Експорт, Деплой, Маркет, Адмін, Довідка; консольний інтерфейс із 25 командами; HTTP-API із 95 маршрутами; публічний режим із входом підписом гаманця (EIP-4361, Phantom), кредитами й оплатою USDC у Solana без посередника; шлях випуску `release-init → upload → hidden → guards → mint → reveal → verify` з локальним підписом. Якість підтверджено 457 автоматичними тестами, перевіркою узгодженості документації з кодом та інтерфейсних перекладів (1752 ключів, українська й англійська).

**Практичне значення.** Система розгорнута як сервіс і може використовуватися авторами колекцій без технічної підготовки; її архітектурні рішення (детермінізм, ворота перевірки, відсутність ключів на сервері) придатні для інших систем випуску цифрових активів.

**Ключові слова:** ВЕБ-САЙТ, NFT, ГЕНЕРАЦІЯ ЗОБРАЖЕНЬ, БЛОКЧЕЙН, ДЕТЕРМІНОВАНИЙ ГЕНЕРАТОР, SOLANA, CORE CANDY MACHINE, ARWEAVE, USDC, SQLITE, СИСТЕМНИЙ АНАЛІЗ.

---

# ABSTRACT

Diploma thesis: 75 pp., 21 figures, 62 tables, 8 appendices, 28 references.

**Object of research:** the process of creating a collection of digital assets (NFTs) with a reproducible set of unique images and preparing it for public release on Solana.

**Subject of research:** methods and software for deterministic generation of collection item descriptions (recipes), automatic readiness checks of the release archive, and safe payment for services in a stablecoin without sending private keys to the server.

**Purpose:** to develop a website and web system for generating NFT images for blockchain (implemented as the Series Lab suite), guiding a collection author from a base image to a verified archive and a release kit without ever accepting or storing the author's private keys.

**Methods:** systems analysis and comparison of analogues; modular design; deterministic pseudo-random generators (FNV-1a, mulberry32); SHA-256 hashing; automated testing (457 tests); continuous integration; containerisation.

**Results.** A Node.js system (version 1.9.0, six runtime dependencies) has been built: a browser studio (Overview, Base, Constructor, Recipes, Generate, Review, Export, Deploy, Market, Admin, Help), a command-line interface with 25 commands, an HTTP API with 95 routes, a public mode with wallet-signature sign-in (EIP-4361, Phantom), credits and direct USDC payments on Solana, and a release path `release-init → upload → hidden → guards → mint → reveal → verify` signed locally. Quality is backed by 457 automated tests and consistency checks of documentation against code and of interface translations (1640 keys, Ukrainian and English).

**Practical value.** The system is deployed as a service and can be used by collection authors without technical background; its design decisions (determinism, verification gates, no keys on the server) apply to other digital-asset release systems.

**Keywords:** WEBSITE, NFT, IMAGE GENERATION, BLOCKCHAIN, DETERMINISTIC GENERATOR, SOLANA, CORE CANDY MACHINE, ARWEAVE, USDC, SQLITE, SYSTEMS ANALYSIS.
