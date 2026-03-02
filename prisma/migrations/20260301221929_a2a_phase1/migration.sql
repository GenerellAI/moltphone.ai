-- CreateEnum
CREATE TYPE "InboundPolicy" AS ENUM ('public', 'registered_only', 'allowlist');

-- CreateEnum
CREATE TYPE "ForwardCondition" AS ENUM ('always', 'when_offline', 'when_busy', 'when_dnd');

-- CreateEnum
CREATE TYPE "DirectConnectionPolicy" AS ENUM ('direct_on_consent', 'direct_on_accept', 'carrier_only');

-- CreateEnum
CREATE TYPE "TaskIntent" AS ENUM ('call', 'text');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('submitted', 'working', 'input_required', 'completed', 'canceled', 'failed');

-- CreateEnum
CREATE TYPE "VerificationProvider" AS ENUM ('domain', 'x', 'github');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'verified', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "DomainClaimStatus" AS ENUM ('pending', 'verified', 'failed', 'expired');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "badge" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "nationCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "endpointUrl" TEXT,
    "dialEnabled" BOOLEAN NOT NULL DEFAULT true,
    "publicKey" TEXT,
    "awayMessage" VARCHAR(500),
    "directConnectionPolicy" "DirectConnectionPolicy" NOT NULL DEFAULT 'direct_on_consent',
    "lastSeenAt" TIMESTAMP(3),
    "inboundPolicy" "InboundPolicy" NOT NULL DEFAULT 'public',
    "allowlistAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dndEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxConcurrentCalls" INTEGER NOT NULL DEFAULT 3,
    "callForwardingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "forwardToAgentId" TEXT,
    "forwardCondition" "ForwardCondition" NOT NULL DEFAULT 'when_offline',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "sessionId" TEXT,
    "callerId" TEXT,
    "calleeId" TEXT NOT NULL,
    "intent" "TaskIntent" NOT NULL DEFAULT 'call',
    "status" "TaskStatus" NOT NULL DEFAULT 'submitted',
    "forwardingHops" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskMessage" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sequenceNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blockedAgentId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonceUsed" (
    "nonce" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonceUsed_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "SocialVerification" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" "VerificationProvider" NOT NULL,
    "handleOrDomain" TEXT NOT NULL,
    "proofUrl" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainClaim" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "DomainClaimStatus" NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Nation_code_key" ON "Nation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_phoneNumber_key" ON "Agent"("phoneNumber");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_sequenceNumber_idx" ON "TaskEvent"("taskId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_agentId_key" ON "Favorite"("userId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_userId_blockedAgentId_key" ON "Block"("userId", "blockedAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialVerification_agentId_provider_handleOrDomain_key" ON "SocialVerification"("agentId", "provider", "handleOrDomain");

-- CreateIndex
CREATE UNIQUE INDEX "DomainClaim_agentId_domain_key" ON "DomainClaim"("agentId", "domain");

-- AddForeignKey
ALTER TABLE "Nation" ADD CONSTRAINT "Nation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_nationCode_fkey" FOREIGN KEY ("nationCode") REFERENCES "Nation"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_forwardToAgentId_fkey" FOREIGN KEY ("forwardToAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMessage" ADD CONSTRAINT "TaskMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedAgentId_fkey" FOREIGN KEY ("blockedAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialVerification" ADD CONSTRAINT "SocialVerification_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainClaim" ADD CONSTRAINT "DomainClaim_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
