<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Watcher\Captcha;

use App\Infrastructure\Watcher\Captcha\LaravelCaptchaSessionUrlBuilder;
use PHPUnit\Framework\TestCase;

final class LaravelCaptchaSessionUrlBuilderTest extends TestCase
{
    public function test_it_builds_the_captcha_html_url_from_the_app_url(): void
    {
        $builder = new LaravelCaptchaSessionUrlBuilder('https://cita-watcher.example.com');

        $this->assertSame(
            'https://cita-watcher.example.com/captcha.html?token=abc123',
            $builder->build('abc123'),
        );
    }

    public function test_it_strips_a_trailing_slash_from_the_configured_app_url(): void
    {
        $builder = new LaravelCaptchaSessionUrlBuilder('https://cita-watcher.example.com/');

        $this->assertSame(
            'https://cita-watcher.example.com/captcha.html?token=abc123',
            $builder->build('abc123'),
        );
    }
}
