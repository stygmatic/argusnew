CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Robot registry
CREATE TABLE robots (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    robot_type  TEXT NOT NULL CHECK (robot_type IN ('drone', 'ground', 'underwater')),
    home_lat    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    home_lon    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    home_alt    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Telemetry time-series (TimescaleDB hypertable)
CREATE TABLE telemetry (
    time            TIMESTAMPTZ NOT NULL,
    robot_id        TEXT NOT NULL REFERENCES robots(id),
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    altitude        DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    heading         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    speed           DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    battery_percent DOUBLE PRECISION,
    signal_strength DOUBLE PRECISION,
    extra           JSONB DEFAULT '{}'
);
SELECT create_hypertable('telemetry', 'time');
CREATE INDEX idx_telemetry_robot ON telemetry(robot_id, time DESC);

SELECT add_retention_policy('telemetry', INTERVAL '7 days');

-- 1-minute downsampled continuous aggregate
CREATE MATERIALIZED VIEW telemetry_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    robot_id,
    AVG(latitude) AS avg_lat,
    AVG(longitude) AS avg_lon,
    AVG(altitude) AS avg_alt,
    AVG(speed) AS avg_speed,
    MIN(battery_percent) AS min_battery,
    AVG(signal_strength) AS avg_signal
FROM telemetry
GROUP BY bucket, robot_id;

SELECT add_continuous_aggregate_policy('telemetry_1m',
    start_offset => INTERVAL '2 hours',
    end_offset   => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

-- Command history
CREATE TABLE commands (
    id           TEXT PRIMARY KEY,
    robot_id     TEXT NOT NULL REFERENCES robots(id),
    command_type TEXT NOT NULL,
    parameters   JSONB NOT NULL DEFAULT '{}',
    source       TEXT NOT NULL DEFAULT 'operator',
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_commands_robot ON commands(robot_id, created_at DESC);
CREATE INDEX idx_commands_status ON commands(status);

-- Autonomy tier on robots
ALTER TABLE robots ADD COLUMN IF NOT EXISTS autonomy_tier TEXT NOT NULL DEFAULT 'assisted';

-- Autonomy change log
CREATE TABLE autonomy_log (
    id          TEXT PRIMARY KEY,
    robot_id    TEXT NOT NULL,
    old_tier    TEXT NOT NULL,
    new_tier    TEXT NOT NULL,
    changed_by  TEXT NOT NULL DEFAULT 'operator',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_autonomy_log_robot ON autonomy_log(robot_id, created_at DESC);

-- Missions
CREATE TABLE missions (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft',
    assigned_robots TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Waypoints (per-robot within a mission)
CREATE TABLE waypoints (
    id          TEXT PRIMARY KEY,
    mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    robot_id    TEXT NOT NULL REFERENCES robots(id),
    sequence    INTEGER NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    altitude    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    action      TEXT NOT NULL DEFAULT 'navigate',
    parameters  JSONB NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (mission_id, robot_id, sequence)
);
CREATE INDEX idx_waypoints_mission ON waypoints(mission_id);
