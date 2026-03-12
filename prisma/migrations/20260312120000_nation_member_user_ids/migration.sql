-- AlterTable
ALTER TABLE "Nation" ADD COLUMN "memberUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
