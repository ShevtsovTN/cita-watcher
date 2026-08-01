<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Notification\ValueObjects;

use App\Domain\Notification\ValueObjects\DeliveryFailure;
use PHPUnit\Framework\TestCase;

final class DeliveryFailureTest extends TestCase
{
    public function test_getters_return_constructor_values(): void
    {
        $failure = new DeliveryFailure(code: 429, message: 'Too Many Requests', retryable: true);

        $this->assertSame(429, $failure->getCode());
        $this->assertSame('Too Many Requests', $failure->getMessage());
        $this->assertTrue($failure->isRetryable());
    }

    public function test_retryable_defaults_to_false(): void
    {
        $failure = new DeliveryFailure(code: 400, message: 'Bad Request');

        $this->assertFalse($failure->isRetryable());
    }
}
