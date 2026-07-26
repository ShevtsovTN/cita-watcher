<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Notification\ValueObjects;

use App\Domain\Notification\ValueObjects\NotificationMessage;
use PHPUnit\Framework\TestCase;

final class NotificationMessageTest extends TestCase
{
    public function test_defaults_parse_mode_to_html_and_additional_params_to_empty_array(): void
    {
        $message = new NotificationMessage('hello');

        $this->assertSame('hello', $message->text);
        $this->assertSame('HTML', $message->parseMode);
        $this->assertSame([], $message->additionalParams);
    }

    public function test_constructor_assigns_all_properties(): void
    {
        $message = new NotificationMessage(
            text: 'hello',
            parseMode: null,
            additionalParams: ['disable_notification' => true],
        );

        $this->assertSame('hello', $message->text);
        $this->assertNull($message->parseMode);
        $this->assertSame(['disable_notification' => true], $message->additionalParams);
    }
}
