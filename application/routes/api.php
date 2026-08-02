<?php

declare(strict_types=1);

use App\Presentation\Http\Controllers\WatchTaskController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('/watch-tasks', [WatchTaskController::class, 'index']);
    Route::post('/watch-tasks', [WatchTaskController::class, 'store']);
    Route::get('/watch-tasks/{watchTask}', [WatchTaskController::class, 'show']);
    Route::delete('/watch-tasks/{watchTask}', [WatchTaskController::class, 'destroy']);
    Route::post('/watch-tasks/{watchTask}/pause', [WatchTaskController::class, 'pause']);
    Route::post('/watch-tasks/{watchTask}/resume', [WatchTaskController::class, 'resume']);
});
