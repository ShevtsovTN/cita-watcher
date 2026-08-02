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

            // ApplicantData value object — plain columns for now, see docs/APPLICATION_ROADMAP.md
            // Phase 5 for turning these into encrypted columns.
            $table->string('applicant_full_name');
            $table->string('applicant_document_id');
            $table->string('applicant_email');
            $table->string('applicant_phone')->nullable();

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
