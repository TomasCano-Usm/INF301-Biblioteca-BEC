-- V001. Ejecutar conectado como propietario BEC_<SERVICIO>, nunca como SYS.
CREATE TABLE bec_records (
  kind VARCHAR2(40) NOT NULL,
  id VARCHAR2(100) NOT NULL,
  payload CLOB NOT NULL CHECK (payload IS JSON),
  state VARCHAR2(40),
  owner_id VARCHAR2(100),
  due_at VARCHAR2(40),
  ready_at VARCHAR2(40),
  search_text VARCHAR2(1500),
  version NUMBER DEFAULT 1 NOT NULL,
  CONSTRAINT bec_records_pk PRIMARY KEY(kind,id),
  CONSTRAINT bec_version_ck CHECK (version >= 1)
);
CREATE INDEX bec_lookup ON bec_records(kind,owner_id,state);
CREATE INDEX bec_due ON bec_records(kind,due_at);
CREATE TABLE bec_lock (id NUMBER PRIMARY KEY CHECK (id=1));
INSERT INTO bec_lock(id) VALUES(1);
CREATE TABLE bec_schema_version (version NUMBER PRIMARY KEY, applied_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP);
INSERT INTO bec_schema_version(version) VALUES(1);
COMMIT;
