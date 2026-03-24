-- Cerul Content Sources Seed
-- 可在本地 PG 或线上 Neon 跑，幂等（ON CONFLICT DO UPDATE）
--
-- 用法：
--   psql "$DATABASE_URL" -f scripts/seed-sources.sql
--
-- 注意：需要先跑 009_content_sources_upgrade.sql migration

BEGIN;

-- ============================================================
-- Tier 1: 核心高频
-- ============================================================

INSERT INTO content_sources (slug, track, display_name, source_type, config, is_active)
VALUES
  ('openai', 'unified', 'OpenAI', 'youtube',
   '{"channel_id": "UCXZCJLdBC09xxGZ6gcdrc6A", "max_results": 50}'::jsonb, TRUE),

  ('anthropic', 'unified', 'Anthropic', 'youtube',
   '{"channel_id": "UCrDwWp7EBBv4NwvScIpBDOA", "max_results": 50}'::jsonb, TRUE),

  ('google-deepmind', 'unified', 'Google DeepMind', 'youtube',
   '{"channel_id": "UCP7jMXSY2xbc3KCAE0MHQ-A", "max_results": 50}'::jsonb, TRUE),

  ('y-combinator', 'unified', 'Y Combinator', 'youtube',
   '{"channel_id": "UCcefcZRL2oaA_uBNeo5UOWg", "max_results": 50}'::jsonb, TRUE),

  ('a16z', 'unified', 'a16z', 'youtube',
   '{"channel_id": "UC9cn0TuPq4dnbTY-CBsm8XA", "max_results": 50}'::jsonb, TRUE),

  ('lex-fridman', 'unified', 'Lex Fridman', 'youtube',
   '{"channel_id": "UCSHZKyawb77ixDdsGog4iWA", "max_results": 30}'::jsonb, TRUE),

  ('all-in-podcast', 'unified', 'All-In Podcast', 'youtube',
   '{"channel_id": "UChJM-mF-4w_61Z6eCyl0eKQ", "max_results": 30}'::jsonb, TRUE),

  ('no-priors', 'unified', 'No Priors', 'youtube',
   '{"channel_id": "UCSI7h9hydQ40K5MJHnCrQvw", "max_results": 30}'::jsonb, TRUE),

  ('andrej-karpathy', 'unified', 'Andrej Karpathy', 'youtube',
   '{"channel_id": "UCXUPKJO5MZQN11PqgIvyuvQ", "max_results": 30}'::jsonb, TRUE)

ON CONFLICT (slug) DO UPDATE SET
  track = EXCLUDED.track,
  display_name = EXCLUDED.display_name,
  source_type = EXCLUDED.source_type,
  config = EXCLUDED.config,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- ============================================================
-- Tier 2: 重要补充
-- ============================================================

INSERT INTO content_sources (slug, track, display_name, source_type, config, is_active)
VALUES
  ('nvidia-ai', 'unified', 'NVIDIA AI', 'youtube',
   '{"channel_id": "UCpmsQ0J0JzKwRZ9xA4tNnnA", "max_results": 30}'::jsonb, TRUE),

  ('microsoft-research', 'unified', 'Microsoft Research', 'youtube',
   '{"channel_id": "UCCb9_Kn8F_Opb3UCGm-lILQ", "max_results": 30}'::jsonb, TRUE),

  ('meta-ai', 'unified', 'Meta AI', 'youtube',
   '{"channel_id": "UCh6InhosKmD_Fofs9XJdz6Q", "max_results": 30}'::jsonb, TRUE),

  ('20vc', 'unified', '20VC', 'youtube',
   '{"channel_id": "UCf0PBRjhf0rF8fWBIxTuoWA", "max_results": 30}'::jsonb, TRUE),

  ('bg2-pod', 'unified', 'BG2 Pod', 'youtube',
   '{"channel_id": "UC-yRDvpR99LUc5l7i7jLzew", "max_results": 30}'::jsonb, TRUE),

  ('sequoia-capital', 'unified', 'Sequoia Capital', 'youtube',
   '{"channel_id": "UCWrF0oN6unbXrWsTN7RctTw", "max_results": 30}'::jsonb, TRUE),

  ('ml-street-talk', 'unified', 'Machine Learning Street Talk', 'youtube',
   '{"channel_id": "UCMLtBahI5DMrt0NPvDSoIRQ", "max_results": 30}'::jsonb, TRUE),

  ('weights-and-biases', 'unified', 'Weights & Biases', 'youtube',
   '{"channel_id": "UCBp3w4DCEC64FZr4k9ROxig", "max_results": 30}'::jsonb, TRUE),

  ('hugging-face', 'unified', 'Hugging Face', 'youtube',
   '{"channel_id": "UCHlNU7kIZhRgSbhHvFoy72w", "max_results": 30}'::jsonb, TRUE),

  ('ai-explained', 'unified', 'AI Explained', 'youtube',
   '{"channel_id": "UCNJ1Ymd5yFuUPtn21xtRbbw", "max_results": 30}'::jsonb, TRUE)

ON CONFLICT (slug) DO UPDATE SET
  track = EXCLUDED.track,
  display_name = EXCLUDED.display_name,
  source_type = EXCLUDED.source_type,
  config = EXCLUDED.config,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- ============================================================
-- Tier 3: 扩展覆盖
-- ============================================================

INSERT INTO content_sources (slug, track, display_name, source_type, config, is_active)
VALUES
  ('fireship', 'unified', 'Fireship', 'youtube',
   '{"channel_id": "UCsBjURrPoezykLs9EqgamOA", "max_results": 30}'::jsonb, TRUE),

  ('two-minute-papers', 'unified', 'Two Minute Papers', 'youtube',
   '{"channel_id": "UCbfYPyITQ-7l4upoX8nvctg", "max_results": 30}'::jsonb, TRUE),

  ('yannic-kilcher', 'unified', 'Yannic Kilcher', 'youtube',
   '{"channel_id": "UCZHmQk67mSJgfCCTn7xBfew", "max_results": 30}'::jsonb, TRUE),

  ('langchain', 'unified', 'LangChain', 'youtube',
   '{"channel_id": "UCC-lyoTfSrcJzA1ab3APAgw", "max_results": 30}'::jsonb, TRUE),

  ('ai-engineer', 'unified', 'AI Engineer', 'youtube',
   '{"channel_id": "UCLKPca3kwwd-B59HNr-_lvA", "max_results": 30}'::jsonb, TRUE),

  ('greylock', 'unified', 'Greylock Partners', 'youtube',
   '{"channel_id": "UCZ7x7yDBbEFCGztD8BYvRhA", "max_results": 30}'::jsonb, TRUE),

  ('techcrunch', 'unified', 'TechCrunch', 'youtube',
   '{"channel_id": "UCCjyq_K1Xwfg8Lndy7lKMpA", "max_results": 30}'::jsonb, TRUE),

  ('bloomberg-tech', 'unified', 'Bloomberg Technology', 'youtube',
   '{"channel_id": "UCdK2BueKxC9VxXh7e1Ne4oQ", "max_results": 30}'::jsonb, TRUE),

  ('mistral-ai', 'unified', 'Mistral AI', 'youtube',
   '{"channel_id": "UCRaz_dquopKtb4ptswKcxTA", "max_results": 30}'::jsonb, TRUE)

ON CONFLICT (slug) DO UPDATE SET
  track = EXCLUDED.track,
  display_name = EXCLUDED.display_name,
  source_type = EXCLUDED.source_type,
  config = EXCLUDED.config,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

COMMIT;
