<?php

declare(strict_types=1);

namespace App\Domain\Watcher\ValueObjects;

use App\Domain\Watcher\Exceptions\InvalidProcedureException;

final readonly class Procedure
{
    public function __construct(
        public string $province,
        public string $tramiteCode,
    ) {
        if (trim($this->province) === '') {
            throw new InvalidProcedureException('Procedure province must not be blank.');
        }

        if (trim($this->tramiteCode) === '') {
            throw new InvalidProcedureException('Procedure trámite code must not be blank.');
        }
    }
}
