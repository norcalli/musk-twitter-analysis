-- Created by claude
-- Build sessions = runs of tweets where every consecutive gap <= SESSION_GAP_SEC.
-- Override the gap by passing -cmd "SET VARIABLE session_gap_sec=600;" to duckdb.

-- Set a default if the caller didn't.
SET VARIABLE session_gap_sec = COALESCE(getvariable('session_gap_sec'), 1800);

DROP TABLE IF EXISTS sessioned;
CREATE TABLE sessioned AS
WITH ordered AS (
  SELECT
    id, ts, day, char_len, is_reply, is_rt, is_quote, is_original,
    EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts))) AS gap_sec
  FROM tweets
), flagged AS (
  SELECT *,
    CASE WHEN gap_sec IS NULL OR gap_sec > getvariable('session_gap_sec') THEN 1 ELSE 0 END AS is_session_start
  FROM ordered
)
SELECT *, SUM(is_session_start) OVER (ORDER BY ts) AS session_id
FROM flagged;

-- Step 2: per-session aggregates.
DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions AS
SELECT
  session_id,
  MIN(ts)                                   AS start_ts,
  MAX(ts)                                   AS end_ts,
  CAST(MIN(ts) AS DATE)                     AS day,
  EXTRACT(YEAR FROM MIN(ts))::INT           AS year,
  EXTRACT(MONTH FROM MIN(ts))::INT          AS month,
  EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts)))   AS span_sec,
  COUNT(*)                                  AS n_total,
  SUM(is_original::INT)                     AS n_original,
  SUM(is_reply::INT)                        AS n_reply,
  SUM(is_quote::INT)                        AS n_quote,
  SUM(is_rt::INT)                           AS n_rt,
  SUM(char_len)::BIGINT                     AS chars_total,
  -- breakdown of chars by type (for typing cost)
  SUM(CASE WHEN is_original THEN char_len ELSE 0 END)::BIGINT AS chars_original,
  SUM(CASE WHEN is_reply    THEN char_len ELSE 0 END)::BIGINT AS chars_reply,
  SUM(CASE WHEN is_quote    THEN char_len ELSE 0 END)::BIGINT AS chars_quote
FROM sessioned
GROUP BY session_id
ORDER BY session_id;

SELECT 'session_gap_sec',     getvariable('session_gap_sec')::VARCHAR
UNION ALL SELECT 'n_sessions',  count(*)::VARCHAR FROM sessions
UNION ALL SELECT 'longest_min', round(max(span_sec)/60.0, 1)::VARCHAR FROM sessions
UNION ALL SELECT 'avg_per_sess',round(avg(n_total), 2)::VARCHAR FROM sessions
UNION ALL SELECT 'biggest_n',   max(n_total)::VARCHAR FROM sessions;
