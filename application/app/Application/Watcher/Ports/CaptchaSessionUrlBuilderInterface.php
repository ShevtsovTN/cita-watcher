<?php

declare(strict_types=1);

namespace App\Application\Watcher\Ports;

/**
 * Narrow port: turns a bare session token (all node-worker publishes — it deliberately doesn't
 * know Laravel's public URL, see docs/NODE_WORKER_ROADMAP.md Phase 7) into a URL a human can
 * actually open. Points at `/captcha.html?token={token}` — a static screencast UI page, not the
 * `/captcha-ws/{token}` WebSocket endpoint itself, which opening directly in a browser wouldn't
 * render anything useful. See docs/APPLICATION_ROADMAP.md Phase 11.
 */
interface CaptchaSessionUrlBuilderInterface
{
    public function build(string $sessionToken): string;
}
