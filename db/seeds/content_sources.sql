-- Seed data: content_sources (YouTube channels)
-- Exported 2026-03-30 from production database.
-- Usage: psql $DATABASE_URL -f db/seeds/content_sources.sql

BEGIN;

INSERT INTO content_sources (slug, track, display_name, source_type, is_active, config)
VALUES
  ('20vc',                 'unified', '20VC',                          'youtube', TRUE, '{"channel_id": "UCf0PBRjhf0rF8fWBIxTuoWA", "max_results": 30}'),
  ('a16z',                 'unified', 'a16z',                          'youtube', TRUE, '{"channel_id": "UC9cn0TuPq4dnbTY-CBsm8XA", "max_results": 50}'),
  ('ai-explained',         'unified', 'AI Explained',                  'youtube', TRUE, '{"channel_id": "UCNJ1Ymd5yFuUPtn21xtRbbw", "max_results": 30}'),
  ('andrej-karpathy',      'unified', 'Andrej Karpathy',               'youtube', TRUE, '{"channel_id": "UCXUPKJO5MZQN11PqgIvyuvQ", "max_results": 30}'),
  ('anthropic',            'unified', 'Anthropic',                     'youtube', TRUE, '{"channel_id": "UCrDwWp7EBBv4NwvScIpBDOA", "max_results": 50}'),
  ('bg2-pod',              'unified', 'BG2 Pod',                       'youtube', TRUE, '{"channel_id": "UC-yRDvpR99LUc5l7i7jLzew", "max_results": 30}'),
  ('dwarkesh-patel',       'unified', 'Dwarkesh Patel',                'youtube', TRUE, '{"channel_id": "UCXl4i9dYBrFOabk0xGmbkRA", "max_results": 30}'),
  ('fireship',             'unified', 'Fireship',                      'youtube', TRUE, '{"channel_id": "UCsBjURrPoezykLs9EqgamOA", "max_results": 30}'),
  ('google-deepmind',      'unified', 'Google DeepMind',               'youtube', TRUE, '{"channel_id": "UCP7jMXSY2xbc3KCAE0MHQ-A", "max_results": 50}'),
  ('greylock',             'unified', 'Greylock Partners',             'youtube', TRUE, '{"channel_id": "UCZ7x7yDBbEFCGztD8BYvRhA", "max_results": 30}'),
  ('hugging-face',         'unified', 'Hugging Face',                  'youtube', TRUE, '{"channel_id": "UCHlNU7kIZhRgSbhHvFoy72w", "max_results": 30}'),
  ('langchain',            'unified', 'LangChain',                     'youtube', TRUE, '{"channel_id": "UCC-lyoTfSrcJzA1ab3APAgw", "max_results": 30}'),
  ('lenny-s-podcast',      'unified', 'Lenny''s Podcast',              'youtube', TRUE, '{"channel_id": "UC6t1O76G0jYXOAoYCm153dA", "max_results": 30}'),
  ('lex-fridman',          'unified', 'Lex Fridman',                   'youtube', TRUE, '{"channel_id": "UCSHZKyawb77ixDdsGog4iWA", "max_results": 30}'),
  ('microsoft-research',   'unified', 'Microsoft Research',            'youtube', TRUE, '{"channel_id": "UCCb9_Kn8F_Opb3UCGm-lILQ", "max_results": 30}'),
  ('ml-street-talk',       'unified', 'Machine Learning Street Talk',  'youtube', TRUE, '{"channel_id": "UCMLtBahI5DMrt0NPvDSoIRQ", "max_results": 30}'),
  ('nikhil-kamath',        'unified', 'Nikhil Kamath',                 'youtube', TRUE, '{"channel_id": "UCnC8SAZzQiBGYVSKZ_S3y4Q", "max_results": 30}'),
  ('nikhil-kamath-clips',  'unified', 'Nikhil Kamath Clips',           'youtube', TRUE, '{"channel_id": "UCRv4waLxgUN0Z-yb2I1Fq4A", "max_results": 30}'),
  ('openai',               'unified', 'OpenAI',                        'youtube', TRUE, '{"channel_id": "UCXZCJLdBC09xxGZ6gcdrc6A", "max_results": 50}'),
  ('pewdiepie',            'unified', 'PewDiePie',                     'youtube', TRUE, '{"channel_id": "UC-lHJZR3Gqxm24_Vd_AJ5Yw", "max_results": 30}'),
  ('sequoia-capital',      'unified', 'Sequoia Capital',               'youtube', TRUE, '{"channel_id": "UCWrF0oN6unbXrWsTN7RctTw", "max_results": 30}'),
  ('techcrunch',           'unified', 'TechCrunch',                    'youtube', TRUE, '{"channel_id": "UCCjyq_K1Xwfg8Lndy7lKMpA", "max_results": 30}'),
  ('two-minute-papers',    'unified', 'Two Minute Papers',             'youtube', TRUE, '{"channel_id": "UCbfYPyITQ-7l4upoX8nvctg", "max_results": 30}'),
  ('y-combinator',         'unified', 'Y Combinator',                  'youtube', TRUE, '{"channel_id": "UCcefcZRL2oaA_uBNeo5UOWg", "max_results": 50}'),
  ('yannic-kilcher',       'unified', 'Yannic Kilcher',                'youtube', TRUE, '{"channel_id": "UCZHmQk67mSJgfCCTn7xBfew", "max_results": 30}'),
  ('zhang-xiaojun-podcast','unified', 'Zhang Xiaojun Podcast',         'youtube', TRUE, '{"channel_id": "UC3Sv1JuKpbOx3csUO8FAo5g", "max_results": 30}')
ON CONFLICT (slug) DO UPDATE SET
  track       = EXCLUDED.track,
  display_name = EXCLUDED.display_name,
  source_type = EXCLUDED.source_type,
  is_active   = EXCLUDED.is_active,
  config      = EXCLUDED.config,
  updated_at  = NOW();

COMMIT;
