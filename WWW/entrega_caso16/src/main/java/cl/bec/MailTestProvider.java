package cl.bec;

import java.time.*;
import java.util.*;
import static cl.bec.Problem.require;

/** Proveedor HTTP autenticado de laboratorio. No afirma entregar correos a Internet. */
public final class MailTestProvider extends Node {
    public MailTestProvider(Config c,Clock clock) throws Exception { super(c,clock,true); }
    @Override protected Reply handle(Request r) {
        if(r.path.equals("/send")&&r.method.equals("POST")) {
            r.callers("notifications");var b=r.json();Validation.fields(b,"id","to","subject","text");
            String id=Validation.text(b,"id",1,100);Validation.text(b,"to",5,160);Validation.text(b,"subject",3,120);Validation.text(b,"text",5,20000);
            store.tx(tx->{
                var old=tx.get("MAIL",id);String digest=Crypto.sha(Json.write(b));
                if(old!=null) {require(digest.equals(old.get("digest")),409,"IDEMPOTENCY_CONFLICT","Mensaje duplicado con cambios.");return null;}
                tx.put("MAIL",Json.map("id",id,"state","ACCEPTED_BY_TEST_PROVIDER","createdAt",now().toString(),"digest",digest,"cipher",Crypto.encrypt(secrets.get("dataKey"),Json.write(b))));return null;
            });return Reply.created(Json.map("id",id,"status","ACCEPTED_BY_TEST_PROVIDER","internetDelivery",false));
        }
        if(r.path.equals("/mailbox")&&r.method.equals("GET")) {
            r.callers("gateway");r.user.roles("ADMIN");
            require(Boolean.TRUE.equals(config.bootstrap.get("labMode")),404,"NOT_FOUND","Bandeja de laboratorio deshabilitada.");
            var rows=store.read(tx->tx.list("MAIL")).stream().map(row->{var m=Json.object(Crypto.decrypt(secrets.get("dataKey"),Json.str(row,"cipher")));m.put("createdAt",row.get("createdAt"));return m;}).toList();
            return Reply.ok(Json.map("adapter","TEST_NO_INTERNET_DELIVERY","items",page(rows,r),"total",rows.size()));
        }
        throw new Problem(404,"NOT_FOUND","Operación del proveedor no publicada.");
    }
    @Override protected void tick() {
        store.tx(tx->{for(var row:tx.list("MAIL")) if(Instant.parse(Json.str(row,"createdAt")).plus(Duration.ofDays(7)).isBefore(now())) tx.delete("MAIL",Json.str(row,"id"));return null;});
    }
}
