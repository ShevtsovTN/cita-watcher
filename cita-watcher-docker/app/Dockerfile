# syntax=docker/dockerfile:1
FROM php:8.4-fpm-alpine

# --- Системные зависимости под нужные PHP-расширения ---
RUN apk add --no-cache \
        postgresql-dev \
        libzip-dev \
        icu-dev \
        oniguruma-dev \
        libpng-dev \
        freetype-dev \
        libjpeg-turbo-dev \
        $PHPIZE_DEPS

# --- PHP-расширения, нужные приложению ---
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" \
        pdo \
        pdo_pgsql \
        pgsql \
        mbstring \
        zip \
        bcmath \
        intl \
        opcache \
        gd \
    && pecl install redis \
    && docker-php-ext-enable redis

# --- Composer (бинарник из официального образа) ---
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# --- Продовый php.ini (opcache и лимиты) ---
# Файл лежит вне основного контекста сборки (../application), поэтому
# берём его из дополнительного именованного контекста "phpconfig"
# (см. additional_contexts в docker-compose.yml -> phpconfig=./app)
COPY --from=phpconfig php.ini /usr/local/etc/php/conf.d/99-app.ini

WORKDIR /var/www/html

# --- Устанавливаем зависимости отдельным слоем, чтобы кешировался composer install ---
COPY composer.json composer.lock ./
RUN composer install \
        --no-dev \
        --no-scripts \
        --no-autoloader \
        --prefer-dist \
        --no-interaction

# --- Копируем остальной код приложения (в dev это перекрывается bind-mount'ом) ---
COPY . .

RUN composer dump-autoload --optimize --no-dev \
    && chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

# --- Entrypoint: чинит владельца storage/bootstrap-cache после bind-mount'а в dev ---
# (лежит в docker/app/, рядом с php.ini — тот же именованный контекст phpconfig)
COPY --from=phpconfig docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 9000

CMD ["php-fpm"]