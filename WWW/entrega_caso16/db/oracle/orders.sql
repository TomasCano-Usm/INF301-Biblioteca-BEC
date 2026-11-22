-- V002-ORDERS. Una notificación de domicilio por préstamo/día.
-- Escribe OUTBOX; el worker consume ese contrato por HTTPS fuera de la transacción.
CREATE OR REPLACE PROCEDURE bec_tick_orders(p_now IN VARCHAR2) AUTHID DEFINER AS
  v_now TIMESTAMP WITH TIME ZONE;
  v_due TIMESTAMP WITH TIME ZONE;
  v_iso VARCHAR2(40);
  v_day VARCHAR2(10);
  v_id VARCHAR2(100);
  v_loan JSON_OBJECT_T;
  v_item JSON_OBJECT_T;
  v_items JSON_ARRAY_T;
  v_event JSON_OBJECT_T;
  v_out JSON_OBJECT_T;
  v_late BOOLEAN;
  v_payload CLOB;
BEGIN
  SELECT TO_UTC_TIMESTAMP_TZ(p_now) INTO v_now FROM dual;
  SELECT TO_CHAR(v_now AT TIME ZONE 'America/Santiago','YYYY-MM-DD') INTO v_day FROM dual;
  FOR r IN (SELECT id,payload FROM bec_records WHERE kind='LOAN' AND state='ACTIVE') LOOP
    v_loan:=JSON_OBJECT_T.parse(r.payload);v_late:=FALSE;
    IF v_loan.get_string('mode')='HOME' THEN
      v_items:=v_loan.get_array('items');
      FOR i IN 0..v_items.get_size()-1 LOOP
        v_item:=TREAT(v_items.get(i) AS JSON_OBJECT_T);
        IF v_item.get_string('state')='ACTIVE' THEN
          v_iso:=v_item.get_string('dueAt');
          SELECT TO_UTC_TIMESTAMP_TZ(v_iso) INTO v_due FROM dual;
          IF v_due<v_now THEN v_late:=TRUE; END IF;
        END IF;
      END LOOP;
      IF v_late THEN
        v_id:='overdue-'||r.id||'-'||v_day;
        v_event:=JSON_OBJECT_T();
        v_event.put('id',v_id);v_event.put('kind','OVERDUE');
        v_event.put('readerId',v_loan.get_string('ownerId'));v_event.put('loanId',r.id);
        v_out:=JSON_OBJECT_T();v_out.put('id',v_id);v_out.put('state','PENDING');v_out.put('event',v_event);
        v_payload:=v_out.to_clob();
        BEGIN
          INSERT INTO bec_records(kind,id,payload,state) VALUES('OUTBOX',v_id,v_payload,'PENDING');
        EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL; -- repetición esperada, no duplica correo
        END;
      END IF;
    END IF;
  END LOOP;
END;
/
SHOW ERRORS
DECLARE
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM user_objects
   WHERE object_name='BEC_TICK_ORDERS' AND object_type='PROCEDURE' AND status='VALID';
  IF v_count<>1 THEN
    RAISE_APPLICATION_ERROR(-20011, 'BEC_TICK_ORDERS no compilo correctamente');
  END IF;
END;
/
MERGE INTO bec_schema_version t USING (SELECT 2 version FROM dual) s ON (t.version=s.version)
 WHEN NOT MATCHED THEN INSERT (version) VALUES (s.version);
COMMIT;
