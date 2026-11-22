package cl.bec;

import java.sql.*;
import java.util.*;
import java.util.function.Function;

/**
 * Repositorio de agregados: un esquema/credencial por servicio, JSON en CLOB y
 * metadatos indexados. No hace JOIN ni usa conexiones de otro subsistema.
 * El cerrojo de escritura es de BD (también protege dos procesos del servicio).
 */
public final class Store {
    private final String url,user,password;
    public final boolean oracle;
    public Store(SecretProvider secrets) {
        url=secrets.get("dbUrl"); user=secrets.get("dbUser"); password=secrets.get("dbPassword");
        oracle=url.startsWith("jdbc:oracle:");
        try(var c=connection(); var s=c.createStatement()) {
            if(!oracle) {
                s.execute("CREATE TABLE IF NOT EXISTS bec_records (kind VARCHAR(40) NOT NULL,id VARCHAR(100) NOT NULL,payload CLOB NOT NULL,state VARCHAR(40),owner_id VARCHAR(100),due_at VARCHAR(40),ready_at VARCHAR(40),search_text VARCHAR(1500),version NUMBER DEFAULT 1 NOT NULL,PRIMARY KEY(kind,id))");
                s.execute("CREATE INDEX IF NOT EXISTS bec_lookup ON bec_records(kind,owner_id,state)");
                s.execute("CREATE INDEX IF NOT EXISTS bec_due ON bec_records(kind,due_at)");
                s.execute("CREATE TABLE IF NOT EXISTS bec_lock (id NUMBER PRIMARY KEY)");
                s.execute("MERGE INTO bec_lock KEY(id) VALUES (1)");
            }
        } catch(SQLException e) { throw new IllegalStateException("No se pudo iniciar persistencia: "+e.getSQLState()); }
    }
    private Connection connection() throws SQLException { return DriverManager.getConnection(url,user,password); }
    public <T>T read(Function<Tx,T> operation) { return run(false,operation); }
    public <T>T tx(Function<Tx,T> operation) { return run(true,operation); }
    private <T>T run(boolean lock,Function<Tx,T> operation) {
        try(var c=connection()) {
            c.setAutoCommit(false);
            if(lock) try(var s=c.prepareStatement("SELECT id FROM bec_lock WHERE id=1 FOR UPDATE"); var r=s.executeQuery()) { r.next(); }
            try { T value=operation.apply(new Tx(c)); c.commit(); return value; }
            catch(RuntimeException e) { c.rollback(); throw e; }
        } catch(SQLException e) { throw new Problem(503,"PERSISTENCE_UNAVAILABLE","Persistencia temporalmente no disponible."); }
    }
    public static final class Tx {
        private final Connection c;
        Tx(Connection c) { this.c=c; }
        public Map<String,Object> get(String kind,String id) {
            try(var s=c.prepareStatement("SELECT payload FROM bec_records WHERE kind=? AND id=?")) {
                s.setString(1,kind); s.setString(2,id);
                try(var r=s.executeQuery()) { return r.next() ? Json.object(r.getString(1)) : null; }
            } catch(SQLException e) { throw new IllegalStateException(e); }
        }
        public Map<String,Object> require(String kind,String id) {
            var row=get(kind,id);
            Problem.require(row!=null,404,"NOT_FOUND","No se encontró el recurso solicitado."); return row;
        }
        public List<Map<String,Object>> list(String kind) { return find(kind,null,null,"",20000); }
        public List<Map<String,Object>> find(String kind,String owner,String state,String search,int maximum) {
            String sql="SELECT payload FROM bec_records WHERE kind=?"+(owner!=null?" AND owner_id=?":"")+(state!=null?" AND state=?":"")+(search.isBlank()?"":" AND search_text LIKE ? ESCAPE '\\'")+" ORDER BY id FETCH FIRST ? ROWS ONLY";
            try(var s=c.prepareStatement(sql)) {
                int i=1; s.setString(i++,kind);
                if(owner!=null) s.setString(i++,owner);
                if(state!=null) s.setString(i++,state);
                if(!search.isBlank()) s.setString(i++,"%"+search.toLowerCase(Locale.ROOT).replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%");
                s.setInt(i,maximum);
                var rows=new ArrayList<Map<String,Object>>();
                try(var r=s.executeQuery()) { while(r.next()) rows.add(Json.object(r.getString(1))); } return rows;
            } catch(SQLException e) { throw new IllegalStateException(e); }
        }
        public void put(String kind,Map<String,Object> row) {
            String id=Json.str(row,"id");
            Problem.require(!id.isBlank(),500,"INTERNAL","Identificador interno ausente.");
            boolean exists=get(kind,id)!=null;
            String sql=exists
                ? "UPDATE bec_records SET payload=?,state=?,owner_id=?,due_at=?,ready_at=?,search_text=?,version=version+1 WHERE kind=? AND id=?"
                : "INSERT INTO bec_records(payload,state,owner_id,due_at,ready_at,search_text,kind,id) VALUES(?,?,?,?,?,?,?,?)";
            try(var s=c.prepareStatement(sql)) {
                s.setString(1,Json.write(row)); s.setString(2,Json.str(row,"state")); s.setString(3,Json.str(row,"ownerId"));
                s.setString(4,Json.str(row,"dueAt")); s.setString(5,Json.str(row,"readyAt"));
                s.setString(6,(Json.str(row,"title")+" "+Json.str(row,"author")+" "+Json.str(row,"category")).toLowerCase(Locale.ROOT));
                s.setString(7,kind); s.setString(8,id); s.executeUpdate();
            } catch(SQLException e) { throw new IllegalStateException(e); }
        }
        public void delete(String kind,String id) {
            try(var s=c.prepareStatement("DELETE FROM bec_records WHERE kind=? AND id=?")) { s.setString(1,kind);s.setString(2,id);s.executeUpdate(); }
            catch(SQLException e) { throw new IllegalStateException(e); }
        }
        public void procedure(String name,String now) {
            Problem.require(Set.of("bec_tick_inventory","bec_tick_orders").contains(name),500,"INTERNAL","Procedimiento no permitido.");
            try(var s=c.prepareCall("{call "+name+"(?)}")) { s.setString(1,now); s.execute(); }
            catch(SQLException e) { throw new IllegalStateException(e); }
        }
    }
}
