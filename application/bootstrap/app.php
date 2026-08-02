<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        commands: __DIR__ . '/../routes/console.php',
        health: '/up',
    )
    // Non-standard namespace layout (see application/CLAUDE.md): Artisan commands live under
    // App\Presentation\Console\Commands, not the framework default app/Console/Commands, so they
    // need to be registered explicitly rather than relying on withRouting()'s auto-discovery.
    ->withCommands([
        app_path('Presentation/Console/Commands'),
    ])
    ->withMiddleware(function (Middleware $middleware): void {})
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn(Request $request) => $request->is('api/*'),
        );
    })->create();
