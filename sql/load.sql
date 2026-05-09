-- Created by claude
-- Load Musk tweet dataset into a duckdb table with proper types.
-- Run from project root: `duckdb build/musk.db < sql/load.sql`

DROP TABLE IF EXISTS raw;
CREATE TABLE raw AS
SELECT * FROM read_csv('data/musk_raw.csv', header=true, sample_size=-1, ignore_errors=false);

-- Build a normalized analysis table.
DROP TABLE IF EXISTS tweets;
CREATE TABLE tweets AS
SELECT
  id::BIGINT                           AS id,
  fullText                             AS text,
  COALESCE(LENGTH(fullText), 0)        AS char_len,
  CAST(createdAt AS TIMESTAMP)         AS ts,
  CAST(createdAt AS TIMESTAMP)::DATE   AS day,
  CAST(retweetCount AS BIGINT)         AS rt,
  CAST(replyCount   AS BIGINT)         AS reply_n,
  CAST(likeCount    AS BIGINT)         AS likes,
  CAST(quoteCount   AS BIGINT)         AS quote_n,
  CAST(viewCount    AS BIGINT)         AS views,
  CAST(bookmarkCount AS BIGINT)        AS bookmarks,
  COALESCE(isReply,   false)           AS is_reply,
  COALESCE(isRetweet, false)           AS is_rt,
  COALESCE(isQuote,   false)           AS is_quote,
  -- "original" = not a reply, not an RT, not a quote
  (NOT COALESCE(isReply,false) AND NOT COALESCE(isRetweet,false) AND NOT COALESCE(isQuote,false)) AS is_original,
  inReplyToUsername                    AS reply_to_user
FROM raw
-- the dataset has trailing rows; keep only ones with a real timestamp.
WHERE createdAt IS NOT NULL;

-- de-dupe on id, keep first.
DROP TABLE IF EXISTS tweets_dedup;
CREATE TABLE tweets_dedup AS
SELECT * EXCLUDE rn FROM (
  SELECT *, row_number() OVER (PARTITION BY id ORDER BY ts) AS rn FROM tweets
) WHERE rn = 1;

DROP TABLE tweets;
ALTER TABLE tweets_dedup RENAME TO tweets;

SELECT 'rows', count(*)::VARCHAR FROM tweets
UNION ALL SELECT 'min_ts',     min(ts)::VARCHAR FROM tweets
UNION ALL SELECT 'max_ts',     max(ts)::VARCHAR FROM tweets
UNION ALL SELECT 'distinct_days', count(DISTINCT day)::VARCHAR FROM tweets
UNION ALL SELECT 'replies',   sum(is_reply::INT)::VARCHAR FROM tweets
UNION ALL SELECT 'retweets',  sum(is_rt::INT)::VARCHAR FROM tweets
UNION ALL SELECT 'quotes',    sum(is_quote::INT)::VARCHAR FROM tweets
UNION ALL SELECT 'originals', sum(is_original::INT)::VARCHAR FROM tweets;
