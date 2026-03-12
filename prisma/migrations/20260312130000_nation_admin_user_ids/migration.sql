-- AlterTable
ALTER TABLE "Nation" ADD COLUMN "adminUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
