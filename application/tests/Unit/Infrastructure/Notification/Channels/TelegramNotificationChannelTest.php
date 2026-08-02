<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Notification\Channels;

use App\Domain\Notification\ValueObjects\NotificationMessage;
use App\Infrastructure\Notification\Channels\TelegramNotificationChannel;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use PHPUnit\Framework\TestCase;

final class TelegramNotificationChannelTest extends TestCase
{
    private const BOT_TOKEN = 'test-bot-token';

    public function test_it_returns_delivered_report_on_successful_response(): void
    {
        $http = new Factory();
        $http->fake([
            'api.telegram.org/*' => $http::response(['ok' => true, 'result' => ['message_id' => 42]], 200),
        ]);

        $channel = new TelegramNotificationChannel($http, self::BOT_TOKEN);

        $report = $channel->send('123456789', new NotificationMessage('Slots found'));

        $this->assertTrue($report->isSuccessful());
        $this->assertSame('telegram', $report->getChannel());
        $this->assertSame('123456789', $report->getTarget());
        $this->assertSame('42', $report->getExternalId());
        $this->assertNotNull($report->getDeliveredAt());

        $http->assertSent(function (Request $request): bool {
            return $request->url() === 'https://api.telegram.org/bot' . self::BOT_TOKEN . '/sendMessage'
                && '123456789' === $request['chat_id']
                && 'Slots found' === $request['text']
                && 'HTML' === $request['parse_mode'];
        });
    }

    public function test_it_includes_additional_params_in_the_request_payload(): void
    {
        $http = new Factory();
        $http->fake([
            'api.telegram.org/*' => $http::response(['ok' => true, 'result' => ['message_id' => 1]], 200),
        ]);

        $channel = new TelegramNotificationChannel($http, self::BOT_TOKEN);

        $message = new NotificationMessage('Slots found', 'Markdown', ['disable_notification' => true]);
        $channel->send('123456789', $message);

        $http->assertSent(function (Request $request): bool {
            return 'Markdown' === $request['parse_mode']
                && true === $request['disable_notification'];
        });
    }

    public function test_it_returns_failed_report_on_client_error_as_not_retryable(): void
    {
        $http = new Factory();
        $http->fake([
            'api.telegram.org/*' => $http::response(['ok' => false, 'description' => 'Bad Request: chat not found'], 400),
        ]);

        $channel = new TelegramNotificationChannel($http, self::BOT_TOKEN);

        $report = $channel->send('000', new NotificationMessage('Slots found'));

        $this->assertFalse($report->isSuccessful());
        $this->assertSame(400, $report->getError()->getCode());
        $this->assertSame('Bad Request: chat not found', $report->getError()->getMessage());
        $this->assertFalse($report->getError()->isRetryable());
    }

    public function test_it_returns_failed_report_on_rate_limit_as_retryable(): void
    {
        $http = new Factory();
        $http->fake([
            'api.telegram.org/*' => $http::response(['ok' => false, 'description' => 'Too Many Requests'], 429),
        ]);

        $channel = new TelegramNotificationChannel($http, self::BOT_TOKEN);

        $report = $channel->send('123456789', new NotificationMessage('Slots found'));

        $this->assertFalse($report->isSuccessful());
        $this->assertTrue($report->getError()->isRetryable());
    }

    public function test_it_returns_failed_report_on_server_error_as_retryable(): void
    {
        $http = new Factory();
        $http->fake([
            'api.telegram.org/*' => $http::response(['ok' => false, 'description' => 'Internal Server Error'], 500),
        ]);

        $channel = new TelegramNotificationChannel($http, self::BOT_TOKEN);

        $report = $channel->send('123456789', new NotificationMessage('Slots found'));

        $this->assertFalse($report->isSuccessful());
        $this->assertTrue($report->getError()->isRetryable());
    }

    public function test_it_returns_failed_report_without_throwing_on_connection_failure(): void
    {
        $http = new Factory();
        $http->fake(function (): never {
            throw new ConnectionException('Connection timed out');
        });

        $channel = new TelegramNotificationChannel($http, self::BOT_TOKEN);

        $report = $channel->send('123456789', new NotificationMessage('Slots found'));

        $this->assertFalse($report->isSuccessful());
        $this->assertTrue($report->getError()->isRetryable());
        $this->assertSame('Connection timed out', $report->getError()->getMessage());
    }
}
