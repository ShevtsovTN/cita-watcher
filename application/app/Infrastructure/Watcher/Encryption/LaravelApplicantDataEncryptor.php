<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Encryption;

use App\Application\Watcher\Ports\ApplicantDataEncryptorInterface;
use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use Illuminate\Contracts\Encryption\Encrypter;

/**
 * Encrypts the whole ApplicantData value object as a single ciphertext blob, using Laravel's own
 * APP_KEY-backed encrypter — see docs/APPLICATION_ROADMAP.md Phase 6 for why a dedicated
 * envelope/rotation scheme wasn't chosen instead. Treating it as one blob (rather than one
 * ciphertext per field) matches ApplicantData already being an indivisible value object
 * everywhere else in the codebase.
 */
final readonly class LaravelApplicantDataEncryptor implements ApplicantDataEncryptorInterface
{
    public function __construct(
        private Encrypter $encrypter,
    ) {}

    public function encrypt(ApplicantData $applicantData): string
    {
        return $this->encrypter->encrypt([
            'fullName' => $applicantData->fullName,
            'documentType' => $applicantData->documentType->value,
            'documentId' => $applicantData->documentId,
            'email' => $applicantData->email,
            'phone' => $applicantData->phone,
            'birthYear' => $applicantData->birthYear,
            'nationality' => $applicantData->nationality,
        ]);
    }

    public function decrypt(string $ciphertext): ApplicantData
    {
        /** @var array{fullName: string, documentType: string, documentId: string, email: string, phone: ?string, birthYear: int, nationality: string} $data */
        $data = $this->encrypter->decrypt($ciphertext);

        return new ApplicantData(
            fullName: $data['fullName'],
            documentType: DocumentTypeEnum::from($data['documentType']),
            documentId: $data['documentId'],
            email: $data['email'],
            birthYear: $data['birthYear'],
            nationality: $data['nationality'],
            phone: $data['phone'],
        );
    }
}
