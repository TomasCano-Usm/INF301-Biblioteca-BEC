package cl.bec;

import java.time.*;
import java.util.*;
import static cl.bec.Problem.require;

public final class OrdersService extends Node {
    public OrdersService(Config c,Clock clock) throws Exception { super(c,clock,true); }
    private String correlation() {return UUID.randomUUID().toString();}
    private void eligible(String owner,Principal user,String correlation) {
        var profile=rpc("clients","GET","/eligibility/"+owner,null,user,correlation);
        require(Boolean.TRUE.equals(profile.get("active")),403,"READER_INACTIVE","El lector debe validar su correo.");
        store.read(tx->{
            var sanction=tx.get("SANCTION",owner);
            require(sanction==null||!Instant.parse(Json.str(sanction,"until")).isAfter(now()),409,"READER_SANCTIONED","El lector tiene una sanción temporal vigente.");
            boolean overdue=tx.find("LOAN",owner,null,"",20000).stream().flatMap(l->Json.rows(l.get("items")).stream())
                .anyMatch(i->Json.str(i,"state").equals("ACTIVE")&&Instant.parse(Json.str(i,"dueAt")).isBefore(now()));
            require(!overdue,409,"READER_OVERDUE","Debe devolver sus préstamos atrasados antes de solicitar material.");return null;
        });
    }
    private Map<String,Object> idempotent(Store.Tx tx,String key,String digest,String kind) {
        var previous=tx.get("IDEMPOTENCY",key);
        if(previous==null) return null;
        require(digest.equals(previous.get("digest"))&&kind.equals(previous.get("kind")),409,"IDEMPOTENCY_CONFLICT","La clave ya se usó con un cuerpo diferente.");
        return tx.require(kind,Json.str(previous,"resourceId"));
    }
    private void remember(Store.Tx tx,String key,String digest,String kind,String resource) {
        tx.put("IDEMPOTENCY",Json.map("id",key,"digest",digest,"kind",kind,"resourceId",resource));
    }
    private Map<String,Object> allocate(Map<String,Object> request) {
        String id=Json.str(request,"id");Principal user=new Principal(Json.str(request,"ownerId"),"READER");
        try {
            var allocation=rpc("inventory","POST","/allocate",Json.map("requestId",id,"readerId",request.get("ownerId"),"copyIds",request.get("copyIds"),"mode",request.get("mode")),user,correlation());
            return store.tx(tx->{var latest=tx.require("REQUEST",id);if(Json.str(latest,"state").equals("ALLOCATING")) {latest.put("state","PENDING");latest.put("items",allocation.get("items"));latest.put("expiresAt",allocation.get("expiresAt"));tx.put("REQUEST",latest);}return latest;});
        } catch(Problem e) {
            if(e.status<500) store.tx(tx->{var latest=tx.require("REQUEST",id);if(Json.str(latest,"state").equals("ALLOCATING")){latest.put("state","FAILED");latest.put("failureCode",e.code);tx.put("REQUEST",latest);}return null;});
            throw e;
        }
    }
    private Map<String,Object> completeLoan(String id) {
        var loan=store.read(tx->tx.require("LOAN",id));
        if(!Json.str(loan,"state").equals("PREPARING")) return loan;
        var allocation=rpc("inventory","POST","/commit",Json.map("requestId",loan.get("requestId"),"loanId",id),new Principal("worker","SYSTEM"),correlation());
        rpc("payments","POST","/assessments",Json.map("loanId",id,"readerId",loan.get("ownerId")),new Principal("worker","SYSTEM"),correlation());
        return store.tx(tx->{
            var latest=tx.require("LOAN",id);if(!Json.str(latest,"state").equals("PREPARING")) return latest;
            latest.put("state","ACTIVE");latest.put("items",allocation.get("items"));latest.put("issuedAt",allocation.get("issuedAt"));
            latest.put("dueAt",Json.rows(allocation.get("items")).stream().map(i->Json.str(i,"dueAt")).min(String::compareTo).orElse(""));
            tx.put("LOAN",latest);var request=tx.require("REQUEST",Json.str(loan,"requestId"));request.put("state","ISSUED");request.put("loanId",id);tx.put("REQUEST",request);
            if(Json.str(latest,"mode").equals("HOME")) outbox(tx,"receipt-"+id,Json.map("id","receipt-"+id,"kind","RECEIPT","readerId",latest.get("ownerId"),"loanId",id,"items",latest.get("items")));
            for(var res:tx.find("RESERVATION",Json.str(loan,"ownerId"),"ACTIVE","",20000)) {
                if(Json.str(res,"date").equals(Instant.parse(Json.str(allocation,"issuedAt")).atZone(Policies.ZONE).toLocalDate().toString())&&
                    Json.rows(allocation.get("items")).stream().anyMatch(i->i.get("copyId").equals(res.get("copyId")))) {res.put("state","CONSUMED");tx.put("RESERVATION",res);}
            }
            return latest;
        });
    }
    private void outbox(Store.Tx tx,String id,Map<String,Object> event) {
        if(tx.get("OUTBOX",id)==null) tx.put("OUTBOX",Json.map("id",id,"state","PENDING","event",event));
    }
    private Map<String,Object> reserve(Map<String,Object> row) {
        var owner=new Principal(Json.str(row,"ownerId"),"READER");
        try {
            rpc("inventory","POST","/reserve",Json.map("reservationId",row.get("id"),"readerId",row.get("ownerId"),"copyId",row.get("copyId"),"date",row.get("date"),"mode",row.get("mode")),owner,correlation());
            return store.tx(tx->{var latest=tx.require("RESERVATION",Json.str(row,"id"));if(Json.str(latest,"state").equals("RESERVING")){latest.put("state","ACTIVE");tx.put("RESERVATION",latest);}return latest;});
        } catch(Problem e) {
            if(e.status<500) store.tx(tx->{var latest=tx.require("RESERVATION",Json.str(row,"id"));if(Json.str(latest,"state").equals("RESERVING")){latest.put("state","FAILED");tx.put("RESERVATION",latest);}return null;});
            throw e;
        }
    }
    private Map<String,Object> completeReturn(String id) {
        var ret=store.read(tx->tx.require("RETURN",id));
        if(Json.str(ret,"state").equals("RETURNED")) return ret;
        var inventory=rpc("inventory","POST","/return",Json.map("loanId",ret.get("loanId"),"copyId",ret.get("copyId"),"returnedAt",ret.get("returnedAt")),new Principal("worker","SYSTEM"),correlation());
        return store.tx(tx->{
            var latest=tx.require("RETURN",id);if(Json.str(latest,"state").equals("RETURNED")) return latest;
            var loan=tx.require("LOAN",Json.str(latest,"loanId"));var items=Json.rows(loan.get("items"));
            for(var item:items) if(latest.get("copyId").equals(item.get("copyId"))) {item.put("state","RETURNED");item.put("returnedAt",latest.get("returnedAt"));item.put("readyAt",inventory.get("readyAt"));}
            loan.put("state",items.stream().allMatch(i->Json.str(i,"state").equals("RETURNED"))?"CLOSED":"ACTIVE");
            loan.put("dueAt",items.stream().filter(i->Json.str(i,"state").equals("ACTIVE")).map(i->Json.str(i,"dueAt")).min(String::compareTo).orElse(""));
            tx.put("LOAN",loan);latest.put("state","RETURNED");latest.put("readyAt",inventory.get("readyAt"));tx.put("RETURN",latest);return latest;
        });
    }
    @Override protected Reply handle(Request r) {
        r.callers("gateway","graphql");r.user.roles("READER","LIBRARIAN","ADMIN");
        if(r.path.equals("/requests")&&r.method.equals("POST")) {
            r.callers("gateway");r.user.roles("READER");var b=r.json();Validation.fields(b,"copyIds","mode");
            var copies=Validation.ids(b,"copyIds");String mode=Validation.mode(b),digest=Crypto.sha(Json.write(b)),key=Crypto.sha(r.user.id()+":"+r.idempotency());
            var existing=store.read(tx->idempotent(tx,key,digest,"REQUEST"));
            if(existing==null) eligible(r.user.id(),r.user,r.correlation);
            var row=store.tx(tx->{
                var old=idempotent(tx,key,digest,"REQUEST");if(old!=null) return old;
                String id="q-"+UUID.randomUUID();var result=Json.map("id",id,"ownerId",r.user.id(),"state","ALLOCATING","mode",mode,"copyIds",copies,"createdAt",now().toString());
                tx.put("REQUEST",result);remember(tx,key,digest,"REQUEST",id);return result;
            });
            if(Json.str(row,"state").equals("ALLOCATING")) row=allocate(row);
            require(!Json.str(row,"state").equals("FAILED"),409,"REQUEST_FAILED","La solicitud falló; revise disponibilidad y use una nueva clave.");
            return Reply.created(row);
        }
        if(r.path.equals("/requests")&&r.method.equals("GET")) {
            r.user.roles("READER","LIBRARIAN");
            var rows=store.read(tx->tx.find("REQUEST",r.user.role().equals("READER")?r.user.id():null,null,"",20000));
            if(r.user.role().equals("LIBRARIAN")) rows=rows.stream().filter(x->Set.of("PENDING","ISSUING","ALLOCATING").contains(Json.str(x,"state"))).toList();
            return Reply.ok(Json.map("items",page(rows,r),"total",rows.size()));
        }
        if(r.path.matches("/requests/[A-Za-z0-9_-]+/issue")&&r.method.equals("POST")) {
            r.callers("gateway");r.user.roles("LIBRARIAN");String id=r.path.split("/")[2];var b=r.json();Validation.fields(b,"rut","fingerprint");
            String rut=Validation.rut(b),fingerprint=Validation.text(b,"fingerprint",32,2048);
            var request=store.read(tx->tx.require("REQUEST",id));
            if(Json.str(request,"state").equals("ISSUED")) return Reply.ok(store.read(tx->tx.require("LOAN",Json.str(request,"loanId"))));
            require(Set.of("PENDING","ISSUING").contains(Json.str(request,"state")),409,"INVALID_STATE","Solicitud no entregable.");
            if(Json.str(request,"state").equals("PENDING")) {
                eligible(Json.str(request,"ownerId"),r.user,r.correlation);
                rpc("clients","POST","/verify",Json.map("readerId",request.get("ownerId"),"rut",rut,"fingerprint",fingerprint),r.user,r.correlation);
                store.tx(tx->{
                    var current=tx.require("REQUEST",id);
                    if(Json.str(current,"state").equals("PENDING")) {
                        require(Instant.parse(Json.str(current,"expiresAt")).isAfter(now()),409,"HOLD_EXPIRED","Solicitud vencida.");
                        String loanId="l-"+id.substring(2);
                        tx.put("LOAN",Json.map("id",loanId,"requestId",id,"ownerId",current.get("ownerId"),"mode",current.get("mode"),"state","PREPARING","items",current.get("items"),"preparedAt",now().toString()));
                        current.put("state","ISSUING");current.put("loanId",loanId);tx.put("REQUEST",current);
                    }return null;
                });
            }
            var latest=store.read(tx->tx.require("REQUEST",id));
            return Reply.ok(completeLoan(Json.str(latest,"loanId")));
        }
        if(r.path.startsWith("/requests/")&&r.method.equals("DELETE")) {
            r.callers("gateway");r.user.roles("READER","LIBRARIAN");String id=r.id("/requests/");
            var row=store.tx(tx->{var x=tx.require("REQUEST",id);r.user.owner(Json.str(x,"ownerId"));
                require(Set.of("PENDING","CANCELLING","CANCELLED").contains(Json.str(x,"state")),409,"INVALID_STATE","Solo se cancela una solicitud pendiente.");
                if(!Json.str(x,"state").equals("CANCELLED")) {x.put("state","CANCELLING");tx.put("REQUEST",x);}return x;});
            if(!Json.str(row,"state").equals("CANCELLED")) cancelRequest(row);
            return Reply.ok(Json.map("id",id,"state","CANCELLED"));
        }
        if(r.path.equals("/loans")&&r.method.equals("GET")) {
            String owner=r.user.role().equals("READER")?r.user.id():r.query.get("readerId");
            if(r.query.containsKey("readerId")) r.user.owner(r.query.get("readerId"));
            var rows=store.read(tx->tx.find("LOAN",owner,null,"",20000));
            var sanction=owner==null?null:store.read(tx->tx.get("SANCTION",owner));
            return Reply.ok(Json.map("items",page(rows,r),"total",rows.size(),"sanctionUntil",sanction==null?null:sanction.get("until")));
        }
        if(r.path.matches("/loans/[A-Za-z0-9_-]+/receipt")&&r.method.equals("GET")) {
            r.user.roles("READER","LIBRARIAN");String id=r.path.split("/")[2];var row=store.read(tx->tx.require("LOAN",id));r.user.owner(Json.str(row,"ownerId"));
            require(Json.str(row,"mode").equals("HOME")&&!Json.str(row,"state").equals("PREPARING"),409,"NO_HOME_RECEIPT","El comprobante corresponde a domicilio entregado.");
            return Reply.ok(Json.map("id","receipt-"+id,"loanId",id,"readerId",row.get("ownerId"),"issuedAt",row.get("issuedAt"),"items",row.get("items"),"amount",0,"currency","CLP"));
        }
        if(r.path.startsWith("/loans/")&&r.method.equals("GET")) {
            var row=store.read(tx->tx.require("LOAN",r.id("/loans/")));r.user.owner(Json.str(row,"ownerId"));return Reply.ok(row);
        }
        if(r.path.equals("/returns")&&r.method.equals("POST")) {
            r.callers("gateway");r.user.roles("LIBRARIAN");var b=r.json();Validation.fields(b,"copyId");String copy=Validation.text(b,"copyId",3,40);
            String digest=Crypto.sha(Json.write(b)),key=Crypto.sha(r.user.id()+":"+r.idempotency());
            var ret=store.tx(tx->{
                var old=idempotent(tx,key,digest,"RETURN");if(old!=null) return old;
                Map<String,Object> loan=null,item=null;
                for(var candidate:tx.list("LOAN")) if(Json.str(candidate,"state").equals("ACTIVE")) for(var i:Json.rows(candidate.get("items")))
                    if(copy.equals(i.get("copyId"))&&Json.str(i,"state").equals("ACTIVE")) {loan=candidate;item=i;break;}
                require(loan!=null&&item!=null,409,"NO_ACTIVE_LOAN","No existe un préstamo activo para ese código.");
                String id="ret-"+UUID.randomUUID();Instant returned=now(),due=Instant.parse(Json.str(item,"dueAt"));
                item.put("state","RETURNING");item.put("returnedAt",returned.toString());tx.put("LOAN",loan);
                Instant until=Policies.sanction(due,returned);
                if(until.isAfter(returned)) {
                    String owner=Json.str(loan,"ownerId");var sanction=tx.get("SANCTION",owner);
                    if(sanction==null||Instant.parse(Json.str(sanction,"until")).isBefore(until)) tx.put("SANCTION",Json.map("id",owner,"ownerId",owner,"state","ACTIVE","until",until.toString(),"rule","DAY_PER_LATE_DAY_MAX_30","sourceReturn",id));
                }
                var row=Json.map("id",id,"loanId",loan.get("id"),"copyId",copy,"returnedAt",returned.toString(),"state","RETURNING","late",returned.isAfter(due),"sanctionUntil",until.isAfter(returned)?until.toString():null);
                tx.put("RETURN",row);remember(tx,key,digest,"RETURN",id);return row;
            });return Reply.ok(completeReturn(Json.str(ret,"id")));
        }
        if(r.path.equals("/reservations")&&r.method.equals("POST")) {
            r.callers("gateway");r.user.roles("READER");var b=r.json();Validation.fields(b,"copyId","date","mode");
            String copy=Validation.text(b,"copyId",3,40),date=Validation.date(b,clock).toString(),mode=Validation.mode(b),key=Crypto.sha(r.user.id()+":"+r.idempotency()),digest=Crypto.sha(Json.write(b));
            var old=store.read(tx->idempotent(tx,key,digest,"RESERVATION"));if(old==null) eligible(r.user.id(),r.user,r.correlation);
            var row=store.tx(tx->{
                var previous=idempotent(tx,key,digest,"RESERVATION");if(previous!=null)return previous;
                String id="v-"+UUID.randomUUID();var x=Json.map("id",id,"ownerId",r.user.id(),"state","RESERVING","copyId",copy,"date",date,"mode",mode,"createdAt",now().toString());
                tx.put("RESERVATION",x);remember(tx,key,digest,"RESERVATION",id);return x;
            });if(Json.str(row,"state").equals("RESERVING"))row=reserve(row);
            require(!Json.str(row,"state").equals("FAILED"),409,"RESERVATION_FAILED","Reserva fallida; utilice otra clave tras revisar disponibilidad.");return Reply.created(row);
        }
        if(r.path.equals("/reservations")&&r.method.equals("GET")) {
            // La cuenta agregada administrativa es lectura privada; S26 sigue sin ADMIN.
            if(r.caller.equals("graphql")) r.user.roles("READER","LIBRARIAN","ADMIN");
            else r.user.roles("READER","LIBRARIAN");
            String owner=r.user.role().equals("READER")?r.user.id():r.query.get("readerId");
            if(r.query.containsKey("readerId"))r.user.owner(r.query.get("readerId"));
            var rows=store.read(tx->tx.find("RESERVATION",owner,null,"",20000));return Reply.ok(Json.map("items",page(rows,r),"total",rows.size()));
        }
        if(r.path.startsWith("/reservations/")&&r.method.equals("DELETE")) {
            r.callers("gateway");r.user.roles("READER","LIBRARIAN");String id=r.id("/reservations/");
            var row=store.tx(tx->{var x=tx.require("RESERVATION",id);r.user.owner(Json.str(x,"ownerId"));
                require(Set.of("ACTIVE","CANCELLING","CANCELLED").contains(Json.str(x,"state")),409,"INVALID_STATE","Solo se cancela una reserva activa.");
                if(!Json.str(x,"state").equals("CANCELLED")){x.put("state","CANCELLING");tx.put("RESERVATION",x);}return x;});
            if(!Json.str(row,"state").equals("CANCELLED"))cancelReservation(row);
            return Reply.ok(Json.map("id",id,"state","CANCELLED"));
        }
        if(r.path.equals("/overdue")&&r.method.equals("GET")) {
            r.callers("gateway");r.user.roles("ADMIN");String mode=r.query.getOrDefault("mode","HOME");require(Set.of("HOME","ROOM").contains(mode),400,"VALIDATION","mode debe ser HOME o ROOM.");
            var rows=store.read(tx->{
                var result=new ArrayList<Map<String,Object>>();
                for(var loan:tx.find("LOAN",null,"ACTIVE","",20000)) if(mode.equals(loan.get("mode"))) for(var item:Json.rows(loan.get("items")))
                    if(Json.str(item,"state").equals("ACTIVE")&&Instant.parse(Json.str(item,"dueAt")).isBefore(now())) result.add(Json.map("loanId",loan.get("id"),"readerId",loan.get("ownerId"),"copyId",item.get("copyId"),"title",item.get("title"),"dueAt",item.get("dueAt"),"mode",mode));
                return result;
            });return Reply.ok(Json.map("items",page(rows,r),"total",rows.size()));
        }
        throw new Problem(404,"NOT_FOUND","Operación de pedidos no publicada.");
    }
    private void cancelRequest(Map<String,Object> row) {
        rpc("inventory","DELETE","/allocations/"+row.get("id"),null,new Principal("worker","SYSTEM"),correlation());
        store.tx(tx->{var x=tx.require("REQUEST",Json.str(row,"id"));x.put("state","CANCELLED");tx.put("REQUEST",x);return null;});
    }
    private void cancelReservation(Map<String,Object> row) {
        rpc("inventory","DELETE","/reservations/"+row.get("id"),null,new Principal(Json.str(row,"ownerId"),"READER"),correlation());
        store.tx(tx->{var x=tx.require("RESERVATION",Json.str(row,"id"));x.put("state","CANCELLED");tx.put("RESERVATION",x);return null;});
    }
    @Override protected void tick() {
        for(var req:store.read(tx->tx.list("REQUEST"))) {
            try {
                switch(Json.str(req,"state")) {
                    case "ALLOCATING" -> allocate(req);
                    case "CANCELLING" -> cancelRequest(req);
                    case "ISSUING" -> {
                        try {completeLoan(Json.str(req,"loanId"));}
                        catch(Problem e) {
                            if(e.status==409&&e.code.equals("HOLD_EXPIRED")) store.tx(tx->{var q=tx.require("REQUEST",Json.str(req,"id"));q.put("state","EXPIRED");tx.put("REQUEST",q);var l=tx.require("LOAN",Json.str(req,"loanId"));l.put("state","ABORTED");tx.put("LOAN",l);return null;});
                            else throw e;
                        }
                    }
                    case "PENDING" -> {
                        if(!Instant.parse(Json.str(req,"expiresAt")).isAfter(now())) {
                            var allocation=rpc("inventory","GET","/allocations/"+req.get("id"),null,new Principal("worker","SYSTEM"),correlation());
                            if(!Set.of("HELD","COMMITTED").contains(Json.str(allocation,"state"))) store.tx(tx->{var latest=tx.require("REQUEST",Json.str(req,"id"));if(Json.str(latest,"state").equals("PENDING")){latest.put("state","EXPIRED");tx.put("REQUEST",latest);}return null;});
                        }
                    }
                }
            } catch(Problem ignored) {}
        }
        for(var ret:store.read(tx->tx.find("RETURN",null,"RETURNING","",100))) try {completeReturn(Json.str(ret,"id"));}catch(Problem ignored){}
        for(var res:store.read(tx->tx.list("RESERVATION"))) {
            try {
                switch(Json.str(res,"state")) {
                    case "RESERVING" -> reserve(res);
                    case "CANCELLING" -> cancelReservation(res);
                    case "ACTIVE" -> {
                        if(LocalDate.parse(Json.str(res,"date")).isBefore(now().atZone(Policies.ZONE).toLocalDate()))store.tx(tx->{var x=tx.require("RESERVATION",Json.str(res,"id"));if(Json.str(x,"state").equals("ACTIVE")){x.put("state","EXPIRED");tx.put("RESERVATION",x);}return null;});
                    }
                }
            }catch(Problem ignored){}
        }
        store.tx(tx->{
            if(store.oracle) {tx.procedure("bec_tick_orders",now().toString());return null;}
            String day=now().atZone(Policies.ZONE).toLocalDate().toString();
            for(var loan:tx.find("LOAN",null,"ACTIVE","",20000)) if(Json.str(loan,"mode").equals("HOME")&&Json.rows(loan.get("items")).stream().anyMatch(i->Json.str(i,"state").equals("ACTIVE")&&Instant.parse(Json.str(i,"dueAt")).isBefore(now()))) {
                String id="overdue-"+loan.get("id")+"-"+day;outbox(tx,id,Json.map("id",id,"kind","OVERDUE","readerId",loan.get("ownerId"),"loanId",loan.get("id")));
            }return null;
        });
        for(var out:store.read(tx->tx.find("OUTBOX",null,"PENDING","",100))) {
            try {
                rpc("notifications","POST","/events",out.get("event"),Principal.ANONYMOUS,correlation());
                store.tx(tx->{var row=tx.require("OUTBOX",Json.str(out,"id"));row.put("state","SENT");tx.put("OUTBOX",row);return null;});
            }catch(Problem ignored){}
        }
    }
}
