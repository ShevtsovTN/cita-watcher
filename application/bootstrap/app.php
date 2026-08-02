<?php

use App\Domain\Watcher\Exceptions\InvalidApplicantDataException;
use App\Domain\Watcher\Exceptions\InvalidProcedureException;
use App\Domain\Watcher\Exceptions\InvalidWatchTaskException;
use App\Domain\Watcher\Exceptions\InvalidWatchTaskTransitionException;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        api: __DIR__ . '/../routes/api.php',
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

        // Domain\Watcher exceptions -> HTTP status mapping, kept out of controllers per
        // application/CLAUDE.md's "no business logic in controllers" rule.
        $exceptions->render(fn(WatchTaskNotFoundException $e) => response()->json(['message' => $e->getMessage()], 404));
        $exceptions->render(fn(InvalidWatchTaskTransitionException $e) => response()->json(['message' => $e->getMessage()], 409));
        $exceptions->render(fn(InvalidProcedureException $e) => response()->json(['message' => $e->getMessage()], 422));
        $exceptions->render(fn(InvalidApplicantDataException $e) => response()->json(['message' => $e->getMessage()], 422));
        $exceptions->render(fn(InvalidWatchTaskException $e) => response()->json(['message' => $e->getMessage()], 422));
    })->create();
