<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('watch_tasks', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // Procedure value object
            $table->string('province');
            $table->string('tramite_code');

            // ApplicantData value object — one ciphertext blob (see
            // Infrastructure\Watcher\Encryption\LaravelApplicantDataEncryptor and
            // docs/APPLICATION_ROADMAP.md Phase 6), not plain columns per field.
            $table->text('applicant_data');

            // Notification preferences
            $table->string('notification_channel');
            $table->string('notification_target');

            $table->string('status')->default('pending');

            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('watch_tasks');
    }
};
