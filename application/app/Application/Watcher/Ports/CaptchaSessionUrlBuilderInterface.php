<?php

declare(strict_types=1);

namespace App\Application\Watcher\Ports;

/**
 * Narrow port: turns a bare session token (all node-worker publishes — it deliberately doesn't
 * know Laravel's public URL, see docs/NODE_WORKER_ROADMAP.md Phase 7) into the full
 * `/captcha-ws/{token}` URL a human can open to reach the CDP screencast relay.
 */
interface CaptchaSessionUrlBuilderInterface
{
    public function build(string $sessionToken): string;
}
