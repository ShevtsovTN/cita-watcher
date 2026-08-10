<?php

use App\Presentation\Console\Commands\DispatchDueAvailabilityChecksCommand;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function (): void {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/**
 * Was `everyFiveMinutes()` — confirmed live (2026-08-10, see
 * ../docs/NODE_WORKER_ROADMAP.md Phase 14) that 5-minute polling against this site's active
 * anti-bot defenses gets the polling IP TCP-blackholed after ~80 minutes/685 requests, recovering
 * only after roughly an hour. Widened to reduce request volume ~3x and lower the odds of repeating
 * that; still not a guarantee against another ban.
 */
Schedule::command(DispatchDueAvailabilityChecksCommand::class)->everyFifteenMinutes();
