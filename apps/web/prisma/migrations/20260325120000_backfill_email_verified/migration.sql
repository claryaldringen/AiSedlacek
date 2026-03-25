-- Backfill emailVerified for existing credential users
UPDATE "User"
SET "emailVerified" = NOW()
WHERE "password" IS NOT NULL
  AND "emailVerified" IS NULL;
