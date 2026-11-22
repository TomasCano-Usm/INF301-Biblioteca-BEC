package cl.bec;

import java.time.Clock;
import java.util.*;
import static cl.bec.Problem.require;

/** Límite deliberado del caso: registra exenciones; jamás cobra ni elimina sanciones. */
public final class PaymentsService extends Node {
    public PaymentsService(Config c,Clock clock) throws Exception { super(c,clock,true); }
    @Override protected Reply handle(Request r) {
        if(r.path.equals("/policy")&&r.method.equals("GET")) {
            r.callers("gateway");return Reply.ok(Json.map("id","MUNICIPAL_FREE","currency","CLP","amount",0,"chargesEnabled",false,"sanction","TIME_ONLY"));
        }
        if(r.path.equals("/assessments")&&r.method.equals("POST")) {
            r.callers("orders");var b=r.json();Validation.fields(b,"loanId","readerId");
            String id=Validation.text(b,"loanId",1,100),owner=Validation.text(b,"readerId",1,100);
            var result=store.tx(tx->{
                var old=tx.get("ASSESSMENT",id);
                if(old!=null) {require(owner.equals(old.get("ownerId")),409,"IDEMPOTENCY_CONFLICT","Préstamo asociado a otro titular.");return old;}
                var row=Json.map("id",id,"loanId",id,"ownerId",owner,"amount",0,"currency","CLP","state","EXEMPT","policyId","MUNICIPAL_FREE","createdAt",now().toString());
                tx.put("ASSESSMENT",row);return row;
            });return Reply.created(result);
        }
        if(r.path.equals("/assessments/batch")&&r.method.equals("POST")) {
            r.callers("graphql");r.user.roles("READER","LIBRARIAN","ADMIN");var b=r.json();Validation.fields(b,"loanIds");
            require(b.get("loanIds") instanceof List<?> ids&&ids.size()<=20,400,"BATCH_LIMIT","Máximo veinte préstamos.");
            var items=new ArrayList<Map<String,Object>>();
            for(Object id:(List<?>)b.get("loanIds")) {
                var row=store.read(tx->tx.get("ASSESSMENT",id.toString()));
                if(row!=null) {r.user.owner(Json.str(row,"ownerId"));items.add(row);}
            }return Reply.ok(Json.map("items",items));
        }
        r.callers("gateway");
        if(r.path.startsWith("/assessments/")&&r.method.equals("GET")) {
            r.user.roles("READER","LIBRARIAN","ADMIN");var row=store.read(tx->tx.require("ASSESSMENT",r.id("/assessments/")));
            r.user.owner(Json.str(row,"ownerId"));return Reply.ok(row);
        }
        if(r.path.equals("/intents")&&r.method.equals("POST")) {
            r.user.roles("READER");throw new Problem(422,"NO_MONETARY_PAYMENTS","El caso no contempla cobros. Un pago nunca levanta una sanción temporal.");
        }
        throw new Problem(404,"NOT_FOUND","Operación de pagos no publicada.");
    }
}
