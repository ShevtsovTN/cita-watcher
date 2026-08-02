<?php

declare(strict_types=1);

namespace App\Application\Watcher\Ports;

use App\Domain\Watcher\ValueObjects\ApplicantData;

/**
 * Narrow port: only knows how to turn an ApplicantData value object into an opaque ciphertext
 * string and back, so WatchTaskRepositoryInterface implementations never persist it in plaintext.
 */
interface ApplicantDataEncryptorInterface
{
    public function encrypt(ApplicantData $applicantData): string;

    public function decrypt(string $ciphertext): ApplicantData;
}
