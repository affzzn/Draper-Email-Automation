-- Add 'internal_domain' to the SuppressionReason enum (§v5.5). Additive; safe on
-- PostgreSQL 12+ where ALTER TYPE ... ADD VALUE runs inside a migration transaction.
ALTER TYPE "SuppressionReason" ADD VALUE 'internal_domain';
