<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Watcher\Encryption;

use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Infrastructure\Watcher\Encryption\LaravelApplicantDataEncryptor;
use Illuminate\Encryption\Encrypter;
use PHPUnit\Framework\TestCase;
use Random\RandomException;

final class LaravelApplicantDataEncryptorTest extends TestCase
{
    /**
     * @throws RandomException
     */
    public function test_it_round_trips_an_applicant_data_value_object(): void
    {
        $applicantData = new ApplicantData(
            fullName: 'Juan Pérez',
            documentId: '12345678A',
            email: 'juan@example.com',
            phone: '600123456',
        );

        $encryptor = new LaravelApplicantDataEncryptor($this->makeEncrypter());

        $ciphertext = $encryptor->encrypt($applicantData);

        $this->assertStringNotContainsString('Juan Pérez', $ciphertext);
        $this->assertStringNotContainsString('12345678A', $ciphertext);
        $this->assertStringNotContainsString('juan@example.com', $ciphertext);

        $decrypted = $encryptor->decrypt($ciphertext);

        $this->assertSame('Juan Pérez', $decrypted->fullName);
        $this->assertSame('12345678A', $decrypted->documentId);
        $this->assertSame('juan@example.com', $decrypted->email);
        $this->assertSame('600123456', $decrypted->phone);
    }

    /**
     * @throws RandomException
     */
    public function test_it_round_trips_a_null_phone(): void
    {
        $applicantData = new ApplicantData(
            fullName: 'Juan Pérez',
            documentId: '12345678A',
            email: 'juan@example.com',
        );

        $encryptor = new LaravelApplicantDataEncryptor($this->makeEncrypter());

        $decrypted = $encryptor->decrypt($encryptor->encrypt($applicantData));

        $this->assertNull($decrypted->phone);
    }

    /**
     * @throws RandomException
     */
    private function makeEncrypter(): Encrypter
    {
        return new Encrypter(random_bytes(32), 'AES-256-CBC');
    }
}
