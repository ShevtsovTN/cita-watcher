<?php

declare(strict_types=1);

namespace App\Domain\Watcher\ValueObjects;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Domain\Watcher\Exceptions\InvalidApplicantDataException;

final readonly class ApplicantData
{
    private const int MIN_BIRTH_YEAR = 1900;

    public function __construct(
        public string $fullName,
        public DocumentTypeEnum $documentType,
        public string $documentId,
        public string $email,
        public int $birthYear,
        public string $nationality,
        public ?string $phone = null,
    ) {
        if ('' === mb_trim($this->fullName)) {
            throw new InvalidApplicantDataException('Applicant full name must not be blank.');
        }

        if ('' === mb_trim($this->documentId)) {
            throw new InvalidApplicantDataException('Applicant document id must not be blank.');
        }

        if ('' === mb_trim($this->email)) {
            throw new InvalidApplicantDataException('Applicant email must not be blank.');
        }

        if ('' === mb_trim($this->nationality)) {
            throw new InvalidApplicantDataException('Applicant nationality must not be blank.');
        }

        $currentYear = (int) date('Y');
        if ($this->birthYear < self::MIN_BIRTH_YEAR || $this->birthYear > $currentYear) {
            throw new InvalidApplicantDataException(
                sprintf('Applicant birth year must be between %d and %d.', self::MIN_BIRTH_YEAR, $currentYear),
            );
        }
    }
}
