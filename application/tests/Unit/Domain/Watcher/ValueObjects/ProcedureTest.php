<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\ValueObjects;

use App\Domain\Watcher\Exceptions\InvalidProcedureException;
use App\Domain\Watcher\ValueObjects\Procedure;
use PHPUnit\Framework\TestCase;

final class ProcedureTest extends TestCase
{
    public function test_constructor_assigns_province_and_tramite_code(): void
    {
        $procedure = new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI');

        $this->assertSame('Madrid', $procedure->province);
        $this->assertSame('CITA_DNI', $procedure->tramiteCode);
        $this->assertNull($procedure->sede);
    }

    public function test_constructor_assigns_an_explicit_sede(): void
    {
        $procedure = new Procedure(province: 'Alicante', tramiteCode: 'CITA_TIE', sede: 'CNP Benidorm TIE');

        $this->assertSame('CNP Benidorm TIE', $procedure->sede);
    }

    public function test_it_rejects_a_blank_province(): void
    {
        $this->expectException(InvalidProcedureException::class);

        new Procedure(province: '  ', tramiteCode: 'CITA_DNI');
    }

    public function test_it_rejects_a_blank_tramite_code(): void
    {
        $this->expectException(InvalidProcedureException::class);

        new Procedure(province: 'Madrid', tramiteCode: '  ');
    }
}
