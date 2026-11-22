-- Solo lectura. Invocado como operador local, sin usar ni imprimir claves SYS.
SET ECHO OFF VERIFY OFF FEEDBACK OFF SERVEROUTPUT ON HEADING OFF PAGESIZE 0 LINESIZE 240
WHENEVER OSERROR EXIT FAILURE
WHENEVER SQLERROR EXIT FAILURE
ALTER SESSION SET CONTAINER = FREEPDB1;
SET SERVEROUTPUT ON
SELECT owner || '.' || object_name || '=' || status
  FROM dba_objects WHERE owner IN ('BEC_INVENTORY','BEC_ORDERS')
    AND object_type='PROCEDURE' ORDER BY owner,object_name;
SELECT owner || '.' || name || ':' || line || ':' || position || ' ' || text
  FROM dba_errors WHERE owner IN ('BEC_INVENTORY','BEC_ORDERS') AND type='PROCEDURE'
  ORDER BY owner,name,sequence;
DECLARE
  v_count NUMBER;
  v_total NUMBER := 0;
BEGIN
  FOR u IN (SELECT username FROM dba_users
             WHERE username IN ('BEC_AUTH','BEC_CLIENTS','BEC_INVENTORY','BEC_ORDERS',
                                'BEC_PAYMENTS','BEC_NOTIFICATIONS','BEC_MAIL')) LOOP
    v_total := v_total + 1;
    SELECT COUNT(*) INTO v_count FROM dba_tables WHERE owner=u.username
      AND table_name IN ('BEC_RECORDS','BEC_LOCK','BEC_SCHEMA_VERSION');
    IF v_count<>3 THEN
      RAISE_APPLICATION_ERROR(-20001, 'Tablas incompletas en ' || u.username);
    END IF;
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || DBMS_ASSERT.SIMPLE_SQL_NAME(u.username) ||
      '.BEC_SCHEMA_VERSION WHERE version=1' INTO v_count;
    IF v_count<>1 THEN
      RAISE_APPLICATION_ERROR(-20002, 'Migracion V001 pendiente en ' || u.username);
    END IF;
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || DBMS_ASSERT.SIMPLE_SQL_NAME(u.username) ||
      '.BEC_LOCK WHERE id=1' INTO v_count;
    IF v_count<>1 THEN
      RAISE_APPLICATION_ERROR(-20003, 'Cerrojo incompleto en ' || u.username);
    END IF;
    IF u.username IN ('BEC_INVENTORY','BEC_ORDERS') THEN
      EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || DBMS_ASSERT.SIMPLE_SQL_NAME(u.username) ||
        '.BEC_SCHEMA_VERSION WHERE version=2' INTO v_count;
      IF v_count<>1 THEN
        RAISE_APPLICATION_ERROR(-20004, 'Migracion V002 pendiente en ' || u.username);
      END IF;
    END IF;
  END LOOP;
  IF v_total<>7 THEN
    RAISE_APPLICATION_ERROR(-20005, 'Faltan esquemas de servicio');
  END IF;
  SELECT COUNT(*) INTO v_count FROM dba_objects
   WHERE object_type='PROCEDURE' AND status='VALID'
     AND ((owner='BEC_INVENTORY' AND object_name='BEC_TICK_INVENTORY')
       OR (owner='BEC_ORDERS' AND object_name='BEC_TICK_ORDERS'));
  IF v_count<>2 THEN
    FOR e IN (SELECT owner,name,line,position,text FROM dba_errors
               WHERE owner IN ('BEC_INVENTORY','BEC_ORDERS') AND type='PROCEDURE'
               ORDER BY owner,name,sequence) LOOP
      DBMS_OUTPUT.PUT_LINE(e.owner || '.' || e.name || ':' || e.line || ':' ||
                           e.position || ' ' || e.text);
    END LOOP;
    RAISE_APPLICATION_ERROR(-20006, 'Hay procedimientos BEC ausentes o INVALID');
  END IF;
END;
/
SELECT 'BEC_SCHEMA_VALIDATION=OK' FROM dual;
EXIT SUCCESS
