-- Migración inicial (docs/arquitectura.md §5.7). No editar una vez aplicada: crear 0002_*.sql.

CREATE TABLE propuestas (
  id          TEXT PRIMARY KEY,           -- 12 base62
  clave_hash  TEXT NOT NULL,              -- SHA-256 hex de claveAdmin
  datos       TEXT NOT NULL,              -- JSON validado de §3.1 (sin avisos)
  ntfy_tema   TEXT,                       -- NULL si no hay push
  usuario_id  TEXT,                       -- futuro (login Google); NULL en v1
  creada_en   INTEGER NOT NULL,           -- epoch ms
  expira_en   INTEGER NOT NULL
);
CREATE INDEX idx_propuestas_expira ON propuestas(expira_en);

CREATE TABLE fotos (
  id            TEXT PRIMARY KEY,         -- f_ + 16 base62
  propuesta_id  TEXT REFERENCES propuestas(id) ON DELETE CASCADE,
  r2_clave      TEXT NOT NULL,            -- fotos/<id>
  tipo_mime     TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  ip_hash       TEXT NOT NULL,
  creada_en     INTEGER NOT NULL
);
CREATE INDEX idx_fotos_propuesta ON fotos(propuesta_id);
CREATE INDEX idx_fotos_huerfanas ON fotos(creada_en) WHERE propuesta_id IS NULL;

CREATE TABLE eventos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,  -- sirve de cursor
  propuesta_id  TEXT NOT NULL REFERENCES propuestas(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('abierto','intento_no','si','celebracion_elegida')),
  datos         TEXT,                     -- JSON: conteo / opcionId / nota
  sesion        TEXT NOT NULL,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_eventos_propuesta ON eventos(propuesta_id, id);
CREATE UNIQUE INDEX uq_eventos_si ON eventos(propuesta_id) WHERE tipo = 'si';

CREATE TABLE limites (
  clave       TEXT PRIMARY KEY,           -- accion:ip_hash:ventana
  conteo      INTEGER NOT NULL,
  expira_en   INTEGER NOT NULL
);
CREATE INDEX idx_limites_expira ON limites(expira_en);
