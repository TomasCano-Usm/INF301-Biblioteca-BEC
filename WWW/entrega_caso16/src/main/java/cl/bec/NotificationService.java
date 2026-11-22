package cl.bec;

import java.time.*;
import java.util.*;
import static cl.bec.Problem.require;

public final class NotificationService extends Node {
    public NotificationService(Config c,Clock clock) throws Exception { super(c,clock,true); }
    @Override protected Reply handle(Request r) {
        r.callers("auth","orders");require(r.path.equals("/events")&&r.method.equals("POST"),404,"NOT_FOUND","Operación no publicada.");
        var b=r.json();Validation.fields(b,"id","kind","readerId","token","loanId","items","mode");
        String id=Validation.text(b,"id",1,100),kind=Validation.text(b,"kind",3,20);
        require(r.caller.equals("auth")?kind.equals("ACTIVATION"):Set.of("RECEIPT","OVERDUE").contains(kind),403,"EVENT_SCOPE","Tipo de evento no autorizado.");
        Validation.text(b,"readerId",1,100);
        String digest=Crypto.sha(Json.write(b));
        store.tx(tx->{
            var old=tx.get("MESSAGE",id);
            if(old!=null) {require(digest.equals(old.get("digest")),409,"IDEMPOTENCY_CONFLICT","Evento repetido con otro contenido.");return null;}
            tx.put("MESSAGE",Json.map("id",id,"state","PENDING","ownerId",b.get("readerId"),"cipher",Crypto.encrypt(secrets.get("dataKey"),Json.write(b)),"digest",digest,"attempts",0,"nextAttemptAt",now().toString()));
            return null;
        });return Reply.created(Json.map("id",id,"accepted",true));
    }
    @Override protected void tick() {
        for(var row:store.read(tx->tx.find("MESSAGE",null,"PENDING","",100))) {
            if(Instant.parse(Json.str(row,"nextAttemptAt")).isAfter(now())) continue;
            try {
                var event=Json.object(Crypto.decrypt(secrets.get("dataKey"),Json.str(row,"cipher")));
                var contact=rpc("clients","GET","/contact/"+event.get("readerId"),null,Principal.ANONYMOUS,UUID.randomUUID().toString());
                String kind=Json.str(event,"kind");
                String content=kind.equals("ACTIVATION")?"Valide su correo: "+Json.str(config.bootstrap,"publicUrl")+"/?activation="+event.get("token"):
                    kind.equals("RECEIPT")?"Comprobante BEC. Préstamo "+event.get("loanId")+". Plazos por ejemplar: "+Json.write(event.get("items")):
                    "Tiene un préstamo de domicilio atrasado: "+event.get("loanId")+". Acérquese a la biblioteca; la sanción es temporal, no monetaria.";
                rpc("mail","POST","/send",Json.map("id",row.get("id"),"to",contact.get("email"),"subject","BEC · "+kind,"text",content),Principal.ANONYMOUS,UUID.randomUUID().toString());
                store.tx(tx->{var latest=tx.require("MESSAGE",Json.str(row,"id"));latest.put("state","DELIVERED");latest.put("deliveredAt",now().toString());latest.remove("cipher");tx.put("MESSAGE",latest);return null;});
            } catch(Problem e) {
                store.tx(tx->{var latest=tx.require("MESSAGE",Json.str(row,"id"));int n=Json.integer(latest,"attempts",0)+1;latest.put("attempts",n);latest.put("nextAttemptAt",now().plusSeconds(Math.min(300,1L<<Math.min(n,8))).toString());tx.put("MESSAGE",latest);return null;});
            }
        }
    }
}
