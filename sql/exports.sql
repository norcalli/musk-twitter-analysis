-- Created by claude
-- Aggregate exports for the website (JSON) plus parquet archives.

-- Parquet archives (compressed cold storage).
COPY (SELECT * FROM tweets ORDER BY ts) TO 'build/tweets.parquet'
  (FORMAT PARQUET, COMPRESSION ZSTD);
COPY (SELECT * FROM sessions ORDER BY session_id) TO 'build/sessions.parquet'
  (FORMAT PARQUET, COMPRESSION ZSTD);

------------------------------------------------------------------
-- 0) per-tweet minimal columns for client-side sessionization.
-- kind: 0=original, 1=reply, 2=quote, 3=rt
------------------------------------------------------------------
COPY (
  WITH t AS (
    SELECT
      EXTRACT(EPOCH FROM ts)::BIGINT AS u,
      CASE WHEN is_rt THEN 3
           WHEN is_quote THEN 2
           WHEN is_reply THEN 1
           ELSE 0
      END::TINYINT AS k,
      char_len::INT AS c
    FROM tweets ORDER BY ts
  )
  SELECT json_object(
    'unix',  list(u),
    'kind',  list(k),
    'chars', list(c)
  ) FROM t
) TO 'build/tweets_min.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');

------------------------------------------------------------------
-- 1) sessions_columnar : columnar arrays for client-side time math.
------------------------------------------------------------------
COPY (
  SELECT
    json_object(
      'start_unix',    list(EXTRACT(EPOCH FROM start_ts)::BIGINT ORDER BY session_id),
      'span_sec',      list(span_sec::INT ORDER BY session_id),
      'n_original',    list(n_original::SMALLINT ORDER BY session_id),
      'n_reply',       list(n_reply::SMALLINT ORDER BY session_id),
      'n_quote',       list(n_quote::SMALLINT ORDER BY session_id),
      'n_rt',          list(n_rt::SMALLINT ORDER BY session_id),
      'chars_original',list(chars_original::INT ORDER BY session_id),
      'chars_reply',   list(chars_reply::INT ORDER BY session_id),
      'chars_quote',   list(chars_quote::INT ORDER BY session_id),
      'hour',          list(EXTRACT(HOUR FROM start_ts)::TINYINT ORDER BY session_id),
      'dow',           list(EXTRACT(DOW FROM start_ts)::TINYINT ORDER BY session_id),
      'year',          list(year::SMALLINT ORDER BY session_id),
      'month',         list(month::TINYINT ORDER BY session_id),
      'day_iso',       list(strftime(start_ts, '%Y-%m-%d') ORDER BY session_id)
    ) AS data
  FROM sessions
) TO 'build/sessions.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');

------------------------------------------------------------------
-- 2) per-tweet hour-of-day × dow × type matrix (for heatmap, no time-math).
------------------------------------------------------------------
COPY (
  WITH counts AS (
    SELECT
      EXTRACT(HOUR FROM ts)::INT AS h,
      EXTRACT(DOW FROM ts)::INT AS d,
      CASE
        WHEN is_rt THEN 'rt'
        WHEN is_reply THEN 'reply'
        WHEN is_quote THEN 'quote'
        ELSE 'original'
      END AS kind,
      COUNT(*) AS n
    FROM tweets
    GROUP BY 1,2,3
  )
  SELECT json_object(
    'h',     list(h),
    'd',     list(d),
    'kind',  list(kind),
    'n',     list(n)
  )
  FROM counts
) TO 'build/hourly.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');

------------------------------------------------------------------
-- 3) per-day breakdown (for calendar heatmap & daily time chart).
------------------------------------------------------------------
COPY (
  WITH d AS (
    SELECT
      day,
      COUNT(*)               AS total,
      SUM(is_original::INT)  AS n_original,
      SUM(is_reply::INT)     AS n_reply,
      SUM(is_quote::INT)     AS n_quote,
      SUM(is_rt::INT)        AS n_rt,
      SUM(char_len)::INT     AS chars
    FROM tweets
    GROUP BY day
    ORDER BY day
  )
  SELECT json_object(
    'day',        list(strftime(day, '%Y-%m-%d')),
    'total',      list(total::INT),
    'n_original', list(n_original::INT),
    'n_reply',    list(n_reply::INT),
    'n_quote',    list(n_quote::INT),
    'n_rt',       list(n_rt::INT),
    'chars',      list(chars)
  )
  FROM d
) TO 'build/daily.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');

------------------------------------------------------------------
-- 4) per-month breakdown (for trend + composition area chart).
------------------------------------------------------------------
COPY (
  WITH m AS (
    SELECT
      strftime(date_trunc('month', ts), '%Y-%m') AS ym,
      COUNT(*)              AS total,
      SUM(is_original::INT) AS n_original,
      SUM(is_reply::INT)    AS n_reply,
      SUM(is_quote::INT)    AS n_quote,
      SUM(is_rt::INT)       AS n_rt,
      SUM(char_len)::INT    AS chars
    FROM tweets
    GROUP BY 1
    ORDER BY 1
  )
  SELECT json_object(
    'ym',         list(ym),
    'total',      list(total::INT),
    'n_original', list(n_original::INT),
    'n_reply',    list(n_reply::INT),
    'n_quote',    list(n_quote::INT),
    'n_rt',       list(n_rt::INT),
    'chars',      list(chars)
  )
  FROM m
) TO 'build/monthly.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');

------------------------------------------------------------------
-- 5) top sessions (longest binges by span).
------------------------------------------------------------------
COPY (
  WITH ranked AS (
    SELECT *
    FROM sessions
    WHERE span_sec >= 1800   -- at least 30 minutes
    ORDER BY span_sec DESC
    LIMIT 50
  )
  SELECT json_object(
    'start_iso',  list(strftime(start_ts, '%Y-%m-%d %H:%M') ORDER BY span_sec DESC),
    'span_sec',   list(span_sec::INT  ORDER BY span_sec DESC),
    'n_total',    list(n_total::INT   ORDER BY span_sec DESC),
    'n_original', list(n_original::INT ORDER BY span_sec DESC),
    'n_reply',    list(n_reply::INT    ORDER BY span_sec DESC),
    'n_quote',    list(n_quote::INT    ORDER BY span_sec DESC),
    'chars',      list(chars_total::INT ORDER BY span_sec DESC),
    'tweets_per_min', list(round(n_total / GREATEST(span_sec/60.0, 1), 2) ORDER BY span_sec DESC)
  )
  FROM ranked
) TO 'build/top_sessions.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');

------------------------------------------------------------------
-- 6) Tweets-per-hour over time, for sleep analysis.
-- (avg tweets per hour-of-day per year, normalized)
------------------------------------------------------------------
COPY (
  WITH per AS (
    SELECT
      EXTRACT(YEAR FROM ts)::INT AS yr,
      EXTRACT(HOUR FROM ts)::INT AS hr,
      COUNT(*)::INT AS n
    FROM tweets
    GROUP BY 1,2
    ORDER BY 1,2
  )
  SELECT json_object(
    'year', list(yr),
    'hour', list(hr),
    'n',    list(n)
  )
  FROM per
) TO 'build/year_hour.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');

------------------------------------------------------------------
-- 7) Top binge days (most tweets in a single day).
------------------------------------------------------------------
COPY (
  WITH d AS (
    SELECT day, COUNT(*) AS n FROM tweets
    GROUP BY day ORDER BY n DESC LIMIT 30
  )
  SELECT json_object(
    'day', list(strftime(day, '%Y-%m-%d') ORDER BY n DESC),
    'n',   list(n::INT ORDER BY n DESC)
  )
  FROM d
) TO 'build/top_days.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');

------------------------------------------------------------------
-- 8) Headline metadata for the page.
------------------------------------------------------------------
COPY (
  SELECT json_object(
    'total_tweets',    (SELECT count(*) FROM tweets),
    'min_date',        (SELECT strftime(min(ts), '%Y-%m-%d') FROM tweets),
    'max_date',        (SELECT strftime(max(ts), '%Y-%m-%d') FROM tweets),
    'distinct_days',   (SELECT count(DISTINCT day) FROM tweets),
    'n_sessions',      (SELECT count(*) FROM sessions),
    'n_original',      (SELECT sum(is_original::INT) FROM tweets),
    'n_reply',         (SELECT sum(is_reply::INT) FROM tweets),
    'n_quote',         (SELECT sum(is_quote::INT) FROM tweets),
    'n_rt',            (SELECT sum(is_rt::INT) FROM tweets),
    'longest_session_min', (SELECT round(max(span_sec)/60.0, 1) FROM sessions),
    'biggest_session_n',   (SELECT max(n_total) FROM sessions),
    'biggest_day_n',       (SELECT max(n) FROM (SELECT count(*) n FROM tweets GROUP BY day))
  )
) TO 'build/meta.json' (FORMAT CSV, HEADER false, QUOTE '', ESCAPE '');
