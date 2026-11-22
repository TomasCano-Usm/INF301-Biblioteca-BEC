-- V002-INVENTORY. Invocación automática por worker; misma transacción/candado
-- que el repositorio. NO COMMIT interno. Instantes ISO 8601 de la aplicación.
CREATE OR REPLACE PROCEDURE bec_tick_inventory(p_now IN VARCHAR2) AUTHID DEFINER AS
  v_now TIMESTAMP WITH TIME ZONE;
  v_expires TIMESTAMP WITH TIME ZONE;
  v_iso VARCHAR2(40);
  v_today VARCHAR2(10);
  v_obj JSON_OBJECT_T;
  v_copy JSON_OBJECT_T;
  v_items JSON_ARRAY_T;
  v_item JSON_OBJECT_T;
  v_payload CLOB;
  v_copy_id VARCHAR2(100);
BEGIN
  -- TO_UTC_TIMESTAMP_TZ es una función SQL, no una función PL/SQL directa.
  SELECT TO_UTC_TIMESTAMP_TZ(p_now) INTO v_now FROM dual;
  SELECT TO_CHAR(v_now AT TIME ZONE 'America/Santiago','YYYY-MM-DD') INTO v_today FROM dual;
  FOR r IN (SELECT id,payload FROM bec_records WHERE kind='COPY' AND state='RESHELVING'
            AND TO_UTC_TIMESTAMP_TZ(ready_at)<=v_now FOR UPDATE) LOOP
    v_obj:=JSON_OBJECT_T.parse(r.payload);
    v_obj.put('state','AVAILABLE'); v_obj.remove('readyAt');
    v_payload:=v_obj.to_clob();
    UPDATE bec_records SET payload=v_payload,state='AVAILABLE',ready_at=NULL,version=version+1
      WHERE kind='COPY' AND id=r.id;
  END LOOP;
  FOR r IN (SELECT id,payload FROM bec_records WHERE kind='ALLOCATION' AND state='HELD' FOR UPDATE) LOOP
    v_obj:=JSON_OBJECT_T.parse(r.payload);
    v_iso:=v_obj.get_string('expiresAt');
    SELECT TO_UTC_TIMESTAMP_TZ(v_iso) INTO v_expires FROM dual;
    IF v_expires<=v_now THEN
      v_items:=v_obj.get_array('items');
      FOR i IN 0..v_items.get_size()-1 LOOP
        v_item:=TREAT(v_items.get(i) AS JSON_OBJECT_T); v_copy_id:=v_item.get_string('copyId');
        SELECT payload INTO v_payload FROM bec_records WHERE kind='COPY' AND id=v_copy_id FOR UPDATE;
        v_copy:=JSON_OBJECT_T.parse(v_payload);
        IF v_copy.get_string('holdId')=r.id THEN
          v_copy.put('state','AVAILABLE');v_copy.remove('holdId');v_copy.remove('readyAt');
          v_payload:=v_copy.to_clob();
          UPDATE bec_records SET payload=v_payload,state='AVAILABLE',ready_at=NULL,version=version+1
            WHERE kind='COPY' AND id=v_copy_id;
        END IF;
      END LOOP;
      v_obj.put('state','EXPIRED');
      v_payload:=v_obj.to_clob();
      UPDATE bec_records SET payload=v_payload,state='EXPIRED',version=version+1
        WHERE kind='ALLOCATION' AND id=r.id;
    END IF;
  END LOOP;
  FOR r IN (SELECT id,payload FROM bec_records WHERE kind='RESERVATION' AND state='ACTIVE' FOR UPDATE) LOOP
    v_obj:=JSON_OBJECT_T.parse(r.payload);
    IF v_obj.get_string('date')<v_today THEN
      v_obj.put('state','EXPIRED');
      v_payload:=v_obj.to_clob();
      UPDATE bec_records SET payload=v_payload,state='EXPIRED',version=version+1
        WHERE kind='RESERVATION' AND id=r.id;
    END IF;
  END LOOP;
END;
/
SHOW ERRORS
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_objects
   WHERE object_name='BEC_TICK_INVENTORY' AND object_type='PROCEDURE' AND status='VALID';
  IF v_count<>1 THEN
    RAISE_APPLICATION_ERROR(-20010, 'BEC_TICK_INVENTORY no compilo correctamente');
  END IF;
END;
/
MERGE INTO bec_schema_version t USING (SELECT 2 version FROM dual) s ON (t.version=s.version)
 WHEN NOT MATCHED THEN INSERT (version) VALUES (s.version);
COMMIT;
