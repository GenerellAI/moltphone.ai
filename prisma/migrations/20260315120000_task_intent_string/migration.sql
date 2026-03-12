-- AlterTable: change intent from enum TaskIntent to plain text
ALTER TABLE "Task" ALTER COLUMN "intent" SET DATA TYPE TEXT;
ALTER TABLE "Task" ALTER COLUMN "intent" SET DEFAULT 'call';

-- Drop the now-unused enum
DROP TYPE IF EXISTS "TaskIntent";
