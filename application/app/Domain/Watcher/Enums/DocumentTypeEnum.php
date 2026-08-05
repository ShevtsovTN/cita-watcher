<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Enums;

/**
 * Which of the three radio options on the real site's applicant form
 * (`/icpplus/acEntrada`: N.I.E./D.N.I./PASAPORTE) — mirrors node-worker's `DocumentType`
 * (node-worker/src/types/commands.ts) case-for-case, lowercase values included. The two sides must
 * stay in sync: this rides in `WorkerCommand`'s wire payload verbatim, see
 * app/Infrastructure/Watcher/Messaging/WorkerCommand.php.
 */
enum DocumentTypeEnum: string
{
    case DNI = 'dni';
    case NIE = 'nie';
    case PASAPORTE = 'pasaporte';
}
