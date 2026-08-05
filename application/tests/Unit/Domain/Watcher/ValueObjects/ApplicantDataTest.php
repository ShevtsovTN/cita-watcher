<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\ValueObjects;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Domain\Watcher\Exceptions\InvalidApplicantDataException;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use PHPUnit\Framework\TestCase;

final class ApplicantDataTest extends TestCase
{
    public function test_constructor_assigns_all_properties(): void
    {
        $applicant = new ApplicantData(
            fullName: 'Juan Pérez',
            documentType: DocumentTypeEnum::DNI,
            documentId: '12345678A',
            email: 'juan@example.com',
            birthYear: 1990,
            nationality: 'España',
            phone: '600123456',
        );

        $this->assertSame('Juan Pérez', $applicant->fullName);
        $this->assertSame(DocumentTypeEnum::DNI, $applicant->documentType);
        $this->assertSame('12345678A', $applicant->documentId);
        $this->assertSame('juan@example.com', $applicant->email);
        $this->assertSame(1990, $applicant->birthYear);
        $this->assertSame('España', $applicant->nationality);
        $this->assertSame('600123456', $applicant->phone);
    }

    public function test_phone_defaults_to_null(): void
    {
        $applicant = new ApplicantData(
            fullName: 'Juan Pérez',
            documentType: DocumentTypeEnum::DNI,
            documentId: '12345678A',
            email: 'juan@example.com',
            birthYear: 1990,
            nationality: 'España',
        );

        $this->assertNull($applicant->phone);
    }

    public function test_it_rejects_a_blank_full_name(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(
            fullName: '  ',
            documentType: DocumentTypeEnum::DNI,
            documentId: '12345678A',
            email: 'juan@example.com',
            birthYear: 1990,
            nationality: 'España',
        );
    }

    public function test_it_rejects_a_blank_document_id(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(
            fullName: 'Juan Pérez',
            documentType: DocumentTypeEnum::DNI,
            documentId: '  ',
            email: 'juan@example.com',
            birthYear: 1990,
            nationality: 'España',
        );
    }

    public function test_it_rejects_a_blank_email(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(
            fullName: 'Juan Pérez',
            documentType: DocumentTypeEnum::DNI,
            documentId: '12345678A',
            email: '  ',
            birthYear: 1990,
            nationality: 'España',
        );
    }

    public function test_it_rejects_a_blank_nationality(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(
            fullName: 'Juan Pérez',
            documentType: DocumentTypeEnum::DNI,
            documentId: '12345678A',
            email: 'juan@example.com',
            birthYear: 1990,
            nationality: '  ',
        );
    }

    public function test_it_rejects_a_birth_year_before_the_minimum(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(
            fullName: 'Juan Pérez',
            documentType: DocumentTypeEnum::DNI,
            documentId: '12345678A',
            email: 'juan@example.com',
            birthYear: 1899,
            nationality: 'España',
        );
    }

    public function test_it_rejects_a_birth_year_in_the_future(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(
            fullName: 'Juan Pérez',
            documentType: DocumentTypeEnum::DNI,
            documentId: '12345678A',
            email: 'juan@example.com',
            birthYear: (int) date('Y') + 1,
            nationality: 'España',
        );
    }
}
