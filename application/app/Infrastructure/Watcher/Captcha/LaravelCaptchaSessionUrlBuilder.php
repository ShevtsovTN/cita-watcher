<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Captcha;

use App\Application\Watcher\Ports\CaptchaSessionUrlBuilderInterface;

/**
 * Takes `config('app.url')` as a constructor argument (bound in WatcherServiceProvider) rather
 * than reading the config() facade directly, matching FindWatchTasksDueForCheckUseCase's
 * maxConcurrentSessions convention — keeps this class a plain PHPUnit\TestCase-testable unit.
 */
final readonly class LaravelCaptchaSessionUrlBuilder implements CaptchaSessionUrlBuilderInterface
{
    public function __construct(
        private string $appUrl,
    ) {}

    public function build(string $sessionToken): string
    {
        return sprintf('%s/captcha-ws/%s', mb_rtrim($this->appUrl, '/'), $sessionToken);
    }
}
