-- V5__add_oauth_to_users.sql

-- Drop the NOT NULL constraint on password_hash to allow OAuth users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Add provider and provider_id for tracking OAuth accounts
ALTER TABLE users ADD COLUMN provider VARCHAR(50);
ALTER TABLE users ADD COLUMN provider_id VARCHAR(255);

-- Optional: index for looking up users by provider id
CREATE INDEX idx_users_provider_id ON users(provider, provider_id);
