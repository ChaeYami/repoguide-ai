-- pgvector 확장 활성화 (research R13). MVP에서는 확장만 켜고 벡터 컬럼·임베딩은 만들지 않는다.
-- Supabase는 확장을 extensions 스키마에 둔다. 다른 Postgres에서도 동작하도록 스키마를 먼저 만든다.
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
