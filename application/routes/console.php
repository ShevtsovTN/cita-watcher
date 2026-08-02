<?php

use App\Presentation\Console\Commands\DispatchDueAvailabilityChecksCommand;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function (): void {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command(DispatchDueAvailabilityChecksCommand::class)->everyFiveMinutes();
