<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\ValueObjects;

use App\Domain\Watcher\Exceptions\InvalidApplicantDataException;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use PHPUnit\Framework\TestCase;

final class ApplicantDataTest extends TestCase
{
    public function test_constructor_assigns_all_properties(): void
    {
        $applicant = new ApplicantData(
            fullName: 'Juan Pérez',
            documentId: '12345678A',
            email: 'juan@example.com',
            phone: '600123456',
        );

        $this->assertSame('Juan Pérez', $applicant->fullName);
        $this->assertSame('12345678A', $applicant->documentId);
        $this->assertSame('juan@example.com', $applicant->email);
        $this->assertSame('600123456', $applicant->phone);
    }

    public function test_phone_defaults_to_null(): void
    {
        $applicant = new ApplicantData(
            fullName: 'Juan Pérez',
            documentId: '12345678A',
            email: 'juan@example.com',
        );

        $this->assertNull($applicant->phone);
    }

    public function test_it_rejects_a_blank_full_name(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(fullName: '  ', documentId: '12345678A', email: 'juan@example.com');
    }

    public function test_it_rejects_a_blank_document_id(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(fullName: 'Juan Pérez', documentId: '  ', email: 'juan@example.com');
    }

    public function test_it_rejects_a_blank_email(): void
    {
        $this->expectException(InvalidApplicantDataException::class);

        new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: '  ');
    }
}
