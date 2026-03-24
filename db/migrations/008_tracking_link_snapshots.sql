BEGIN;

ALTER TABLE tracking_links
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS speaker TEXT,
    ADD COLUMN IF NOT EXISTS unit_type TEXT,
    ADD COLUMN IF NOT EXISTS timestamp_start DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS timestamp_end DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS transcript TEXT,
    ADD COLUMN IF NOT EXISTS visual_desc TEXT,
    ADD COLUMN IF NOT EXISTS keyframe_url TEXT;

UPDATE tracking_links AS tl
SET
    unit_type = COALESCE(tl.unit_type, ru.unit_type),
    timestamp_start = COALESCE(tl.timestamp_start, ru.timestamp_start),
    timestamp_end = COALESCE(tl.timestamp_end, ru.timestamp_end),
    transcript = COALESCE(tl.transcript, ru.transcript),
    visual_desc = COALESCE(tl.visual_desc, ru.visual_desc),
    keyframe_url = COALESCE(tl.keyframe_url, ru.keyframe_url)
FROM retrieval_units AS ru
WHERE ru.id = tl.unit_id;

UPDATE tracking_links AS tl
SET
    title = COALESCE(tl.title, v.title),
    thumbnail_url = COALESCE(tl.thumbnail_url, v.thumbnail_url),
    source = COALESCE(tl.source, v.source),
    speaker = COALESCE(tl.speaker, v.speaker)
FROM videos AS v
WHERE v.id = tl.video_id;

ALTER TABLE tracking_links
    ALTER COLUMN unit_id DROP NOT NULL,
    ALTER COLUMN video_id DROP NOT NULL;

ALTER TABLE tracking_links
    DROP CONSTRAINT IF EXISTS tracking_links_unit_id_fkey,
    DROP CONSTRAINT IF EXISTS tracking_links_video_id_fkey;

ALTER TABLE tracking_links
    ADD CONSTRAINT tracking_links_unit_id_fkey
        FOREIGN KEY (unit_id) REFERENCES retrieval_units(id) ON DELETE SET NULL,
    ADD CONSTRAINT tracking_links_video_id_fkey
        FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE SET NULL;

COMMIT;
