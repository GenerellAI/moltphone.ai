-- CreateEnum
CREATE TYPE "DirectConnectionStatus" AS ENUM ('proposed', 'accepted', 'active', 'rejected', 'revoked', 'expired');

-- AlterEnum
ALTER TYPE "CreditTransactionType" ADD VALUE 'relay_charge';

-- CreateTable
CREATE TABLE "DirectConnection" (
    "id" TEXT NOT NULL,
    "proposerAgentId" TEXT NOT NULL,
    "targetAgentId" TEXT NOT NULL,
    "status" "DirectConnectionStatus" NOT NULL DEFAULT 'proposed',
    "upgradeToken" TEXT,
    "tokenConsumed" BOOLEAN NOT NULL DEFAULT false,
    "proposerEndpoint" TEXT,
    "targetEndpoint" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DirectConnection_upgradeToken_key" ON "DirectConnection"("upgradeToken");

-- CreateIndex
CREATE INDEX "DirectConnection_proposerAgentId_status_idx" ON "DirectConnection"("proposerAgentId", "status");

-- CreateIndex
CREATE INDEX "DirectConnection_targetAgentId_status_idx" ON "DirectConnection"("targetAgentId", "status");

-- CreateIndex
CREATE INDEX "DirectConnection_upgradeToken_idx" ON "DirectConnection"("upgradeToken");

-- CreateIndex
CREATE UNIQUE INDEX "DirectConnection_proposerAgentId_targetAgentId_key" ON "DirectConnection"("proposerAgentId", "targetAgentId");

-- AddForeignKey
ALTER TABLE "DirectConnection" ADD CONSTRAINT "DirectConnection_proposerAgentId_fkey" FOREIGN KEY ("proposerAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectConnection" ADD CONSTRAINT "DirectConnection_targetAgentId_fkey" FOREIGN KEY ("targetAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
