<?php

declare(strict_types=1);

namespace App\Domain\Watcher\ValueObjects;

use App\Domain\Watcher\Exceptions\InvalidApplicantDataException;

final readonly class ApplicantData
{
    public function __construct(
        public string $fullName,
        public string $documentId,
        public string $email,
        public ?string $phone = null,
    ) {
        if (trim($this->fullName) === '') {
            throw new InvalidApplicantDataException('Applicant full name must not be blank.');
        }

        if (trim($this->documentId) === '') {
            throw new InvalidApplicantDataException('Applicant document id must not be blank.');
        }

        if (trim($this->email) === '') {
            throw new InvalidApplicantDataException('Applicant email must not be blank.');
        }
    }
}
