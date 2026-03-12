-- CreateEnum
CREATE TYPE "CarrierPolicyType" AS ENUM ('require_verified_domain', 'require_social_verification', 'minimum_age_hours');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "circuitOpenUntil" TIMESTAMP(3),
ADD COLUMN     "isDegraded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushEndpointUrl" TEXT,
ADD COLUMN     "webhookFailures" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CarrierPolicy" (
    "id" TEXT NOT NULL,
    "type" "CarrierPolicyType" NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarrierPolicy_type_key" ON "CarrierPolicy"("type");

-- CreateIndex
CREATE INDEX "Task_status_nextRetryAt_idx" ON "Task"("status", "nextRetryAt");
