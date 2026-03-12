-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "CarrierBlockType" AS ENUM ('agent_id', 'phone_pattern', 'nation_code', 'ip_address');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE "CarrierBlock" (
    "id" TEXT NOT NULL,
    "type" "CarrierBlockType" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarrierBlock_type_value_key" ON "CarrierBlock"("type", "value");

-- CreateIndex
CREATE INDEX "NonceUsed_expiresAt_idx" ON "NonceUsed"("expiresAt");
