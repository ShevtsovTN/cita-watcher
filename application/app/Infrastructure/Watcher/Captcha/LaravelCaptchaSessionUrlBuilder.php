<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Captcha;

use App\Application\Watcher\Ports\CaptchaSessionUrlBuilderInterface;

/**
 * Takes `config('app.url')` as a constructor argument (bound in WatcherServiceProvider) rather
 * than reading the config() facade directly, matching FindWatchTasksDueForCheckUseCase's
 * maxConcurrentSessions convention — keeps this class a plain PHPUnit\TestCase-testable unit.
 *
 * Points at `application/public/captcha.html`, a static screencast UI page served directly by
 * nginx (not a Laravel route/view) — not at `/captcha-ws/{token}` itself, which is the raw
 * WebSocket endpoint nginx proxies straight to node-worker. Opening that endpoint directly in a
 * browser does nothing useful; `captcha.html` is what actually connects to it and renders the
 * relay. See `../../../../docs/APPLICATION_ROADMAP.md` Phase 11.
 */
final readonly class LaravelCaptchaSessionUrlBuilder implements CaptchaSessionUrlBuilderInterface
{
    public function __construct(
        private string $appUrl,
    ) {}

    public function build(string $sessionToken): string
    {
        return sprintf('%s/captcha.html?token=%s', mb_rtrim($this->appUrl, '/'), $sessionToken);
    }
}
