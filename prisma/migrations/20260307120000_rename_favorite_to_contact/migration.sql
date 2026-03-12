-- Rename Favorite table to Contact
ALTER TABLE "Favorite" RENAME TO "Contact";

-- Rename the unique constraint index
ALTER INDEX "Favorite_pkey" RENAME TO "Contact_pkey";
ALTER INDEX "Favorite_userId_agentId_key" RENAME TO "Contact_userId_agentId_key";
