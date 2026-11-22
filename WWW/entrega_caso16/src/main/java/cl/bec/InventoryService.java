package cl.bec;

import java.time.*;
import java.text.Normalizer;
import java.util.*;
import static cl.bec.Problem.require;

public final class InventoryService extends Node {
    public InventoryService(Config c,Clock clock) throws Exception { super(c,clock,true); }
    private Map<String,Object> documentBody(Map<String,Object> b,String id) {
        Validation.fields(b,"title","author","type","medium","publisher","edition","year","shelf","category","homeDays","roomHours","description","stock");
        String type=Validation.text(b,"type",4,9),medium=Validation.text(b,"medium",2,8);
        require(Set.of("BOOK","TECHNICAL","AUDIO","VIDEO").contains(type),400,"VALIDATION","Tipo documental inválido.");
        require(Set.of("PAPER","CASSETTE","CD","DVD","BLURAY","DIGITAL").contains(medium),400,"VALIDATION","Soporte inválido.");
        require(!(Set.of("BOOK","TECHNICAL").contains(type)&&!medium.equals("PAPER")),400,"VALIDATION","Libros/documentos técnicos usan PAPER.");
        require(!(Set.of("AUDIO","VIDEO").contains(type)&&medium.equals("PAPER")),400,"VALIDATION","Multimedia requiere un soporte audiovisual.");
        String description="";
        if(b.containsKey("description")) {
            require(b.get("description") instanceof String,400,"VALIDATION","Descripción inválida.");
            description=((String)b.get("description")).trim();
            require(description.length()<=2000&&description.chars().noneMatch(c->c<32&&c!='\n'&&c!='\r'&&c!='\t'),400,"VALIDATION","Descripción: máximo 2000 caracteres sin controles.");
        }
        if(b.containsKey("stock")) Validation.number(b,"stock",0,200);
        return Json.map("id",id,"title",Validation.text(b,"title",2,200),"author",Validation.text(b,"author",2,140),
            "type",type,"medium",medium,"publisher",Validation.text(b,"publisher",2,120),"edition",Validation.text(b,"edition",1,40),
            "year",Validation.number(b,"year",1450,Year.now(clock).getValue()),"shelf",Validation.text(b,"shelf",1,40),
            "category",Validation.text(b,"category",2,80),"homeDays",Validation.number(b,"homeDays",1,30),
            "roomHours",Validation.number(b,"roomHours",1,8),"description",description,"state","ACTIVE");
    }
    /**
     * Stock es el total de ejemplares no retirados, no una disponibilidad declarada
     * por el navegador. Alta/edición y ajuste ocurren en UNA transacción local.
     */
    private void resizeStock(Store.Tx tx,Map<String,Object> doc,int wanted) {
        String id=Json.str(doc,"id");
        var copies=tx.list("COPY").stream().filter(c->id.equals(c.get("documentId"))&&!Json.str(c,"state").equals("RETIRED")).toList();
        if(wanted<copies.size()) {
            var reserved=new HashSet<String>();
            for(var res:tx.find("RESERVATION",null,"ACTIVE","",20000)) reserved.add(Json.str(res,"copyId"));
            var removable=copies.stream().filter(c->Json.str(c,"state").equals("AVAILABLE")&&!reserved.contains(Json.str(c,"id"))).toList();
            int count=copies.size()-wanted;
            require(removable.size()>=count,409,"STOCK_IN_USE","No se puede reducir el stock: hay ejemplares prestados, retenidos, en reposición o reservados.");
            for(var c:removable.subList(0,count)) {c.put("state","RETIRED");tx.put("COPY",c);}
        } else {
            String prefix="DOC-"+id.substring(2).replace("-","").substring(0,12).toUpperCase(Locale.ROOT)+"-";
            int next=1;
            for(int i=copies.size();i<wanted;i++) {
                String code;
                do {code=prefix+String.format(Locale.ROOT,"%04d",next++);} while(tx.get("COPY",code)!=null);
                tx.put("COPY",Json.map("id",code,"documentId",id,"state","AVAILABLE","shelf",doc.get("shelf")));
            }
        }
    }
    private static String normalized(String s) {
        return Normalizer.normalize(s,Normalizer.Form.NFD).replaceAll("\\p{M}","").toLowerCase(Locale.ROOT).trim();
    }
    private boolean contains(Map<String,Object> row,String key,String value) {
        return normalized(Json.str(row,key)).contains(normalized(value));
    }
    private Map<String,Object> catalogue(Request r) {
        require(Set.of("q","page","size","title","author","type","publisher","availability","subcategory").containsAll(r.query.keySet()),400,"VALIDATION","Filtro no admitido.");
        for(var value:r.query.values()) require(value.length()<=100,400,"VALIDATION","Filtro demasiado extenso.");
        String q=r.query.getOrDefault("q",""),type=r.query.getOrDefault("type",""),availability=r.query.getOrDefault("availability","");
        require(Set.of("","BOOK","TECHNICAL","AUDIO","VIDEO","MULTIMEDIA").contains(type),400,"VALIDATION","Tipo de documento inválido.");
        require(Set.of("","AVAILABLE","UNAVAILABLE","IN_ROOM").contains(availability),400,"VALIDATION","Disponibilidad inválida.");
        return store.read(tx->{
            var copies=tx.list("COPY");
            var docs=tx.find("DOCUMENT",null,"ACTIVE",q,20000).stream()
                .filter(d->contains(d,"title",r.query.getOrDefault("title","")))
                .filter(d->contains(d,"author",r.query.getOrDefault("author","")))
                .filter(d->contains(d,"publisher",r.query.getOrDefault("publisher","")))
                .filter(d->contains(d,"category",r.query.getOrDefault("subcategory","")))
                .filter(d->type.isEmpty()||(type.equals("MULTIMEDIA")?Set.of("AUDIO","VIDEO").contains(Json.str(d,"type")):type.equals(d.get("type"))))
                .map(d->publicDocument(d,copies))
                .filter(d->availability.isEmpty()||switch(availability) {
                    case "AVAILABLE" -> ((Number)d.get("available")).intValue()>0;
                    case "UNAVAILABLE" -> ((Number)d.get("available")).intValue()==0;
                    default -> ((Number)d.get("inRoom")).intValue()>0;
                }).toList();
            // Se filtra ANTES de paginar: también incluye coincidencias de otras páginas.
            return Json.map("items",page(docs,r),"total",docs.size(),"page",r.page(),"size",r.pageSize());
        });
    }
    private Map<String,Object> publicDocument(Map<String,Object> document,List<Map<String,Object>> copies) {
        var dto=new LinkedHashMap<>(document);
        var mine=copies.stream().filter(c->document.get("id").equals(c.get("documentId"))&&!Json.str(c,"state").equals("RETIRED")).toList();
        dto.put("available",mine.stream().filter(c->Json.str(c,"state").equals("AVAILABLE")).count());
        dto.put("inRoom",mine.stream().filter(c->Json.str(c,"state").equals("ROOM")).count());
        dto.put("total",mine.size());
        dto.put("copies",mine.stream().map(c->Json.map("id",c.get("id"),"state",c.get("state"),"shelf",c.get("shelf"),
            "dueAt",c.get("dueAt"),"readyAt",c.get("readyAt"))).toList());
        return dto;
    }
    private void reservationConflict(Store.Tx tx,String copyId,String readerId,Instant due) {
        LocalDate today=now().atZone(Policies.ZONE).toLocalDate(),last=due.atZone(Policies.ZONE).toLocalDate();
        for(var res:tx.find("RESERVATION",null,"ACTIVE","",20000)) if(copyId.equals(res.get("copyId"))) {
            LocalDate day=LocalDate.parse(Json.str(res,"date"));
            boolean ownToday=readerId.equals(res.get("ownerId"))&&day.equals(today);
            require(ownToday||day.isBefore(today)||day.isAfter(last),409,"RESERVATION_CONFLICT","El plazo invade una reserva de este ejemplar.");
        }
    }
    @Override protected Reply handle(Request r) {
        if(r.path.equals("/allocate")&&r.method.equals("POST")) {
            r.callers("orders");r.user.roles("READER");var b=r.json();Validation.fields(b,"requestId","readerId","copyIds","mode");
            String id=Validation.text(b,"requestId",1,100),owner=Validation.text(b,"readerId",1,100),mode=Validation.mode(b);r.user.owner(owner);
            var ids=Validation.ids(b,"copyIds");String digest=Crypto.sha(Json.write(b));
            var result=store.tx(tx->{
                maintenance(tx);
                var old=tx.get("ALLOCATION",id);
                if(old!=null) {
                    require(digest.equals(old.get("digest")),409,"IDEMPOTENCY_CONFLICT","Asignación repetida con cambios.");
                    require(Set.of("HELD","COMMITTED").contains(Json.str(old,"state")),409,"HOLD_EXPIRED","Asignación no vigente.");return old;
                }
                var items=new ArrayList<Map<String,Object>>();
                for(String copyId:ids) {
                    var copy=tx.require("COPY",copyId);var doc=tx.require("DOCUMENT",Json.str(copy,"documentId"));
                    require(Json.str(doc,"state").equals("ACTIVE")&&Json.str(copy,"state").equals("AVAILABLE"),409,"COPY_UNAVAILABLE","Uno o más ejemplares no están disponibles.");
                    reservationConflict(tx,copyId,owner,Policies.due(doc,mode,now()));
                    items.add(Json.map("copyId",copyId,"documentId",doc.get("id"),"title",doc.get("title"),"homeDays",doc.get("homeDays"),"roomHours",doc.get("roomHours"),"shelf",copy.get("shelf")));
                }
                for(String copyId:ids) {var copy=tx.require("COPY",copyId);copy.put("state","HELD");copy.put("holdId",id);copy.put("readyAt",now().plusSeconds(1200).toString());tx.put("COPY",copy);}
                var row=Json.map("id",id,"state","HELD","ownerId",owner,"mode",mode,"items",items,"digest",digest,"expiresAt",now().plusSeconds(1200).toString());
                tx.put("ALLOCATION",row);return row;
            });return Reply.created(result);
        }
        if(r.path.equals("/commit")&&r.method.equals("POST")) {
            r.callers("orders");var b=r.json();Validation.fields(b,"requestId","loanId");
            String id=Validation.text(b,"requestId",1,100),loan=Validation.text(b,"loanId",1,100);
            var result=store.tx(tx->{
                maintenance(tx);var allocation=tx.require("ALLOCATION",id);
                if(Json.str(allocation,"state").equals("COMMITTED")) {
                    require(loan.equals(allocation.get("loanId")),409,"IDEMPOTENCY_CONFLICT","Asignación ya utilizada.");return allocation;
                }
                require(Json.str(allocation,"state").equals("HELD"),409,"HOLD_EXPIRED","La solicitud expiró; cree otra solicitud.");
                Instant issued=now();String mode=Json.str(allocation,"mode");
                var items=Json.rows(allocation.get("items"));
                for(var item:items) {
                    String copyId=Json.str(item,"copyId");var copy=tx.require("COPY",copyId);
                    require(Json.str(copy,"state").equals("HELD")&&id.equals(copy.get("holdId")),409,"COPY_UNAVAILABLE","Retención de ejemplar inconsistente.");
                    Instant due=Policies.due(item,mode,issued);reservationConflict(tx,copyId,Json.str(allocation,"ownerId"),due);
                    item.put("dueAt",due.toString());item.put("state","ACTIVE");copy.put("state",mode);copy.put("loanId",loan);
                    copy.put("dueAt",due.toString());copy.remove("readyAt");copy.remove("holdId");tx.put("COPY",copy);
                    for(var res:tx.find("RESERVATION",null,"ACTIVE","",20000)) if(copyId.equals(res.get("copyId"))&&allocation.get("ownerId").equals(res.get("ownerId"))&&
                        issued.atZone(Policies.ZONE).toLocalDate().toString().equals(res.get("date"))) {res.put("state","CONSUMED");tx.put("RESERVATION",res);}
                }
                allocation.put("state","COMMITTED");allocation.put("loanId",loan);allocation.put("issuedAt",issued.toString());allocation.put("items",items);tx.put("ALLOCATION",allocation);return allocation;
            });return Reply.ok(result);
        }
        if(r.path.startsWith("/allocations/")) {
            r.callers("orders");String id=r.id("/allocations/");
            if(r.method.equals("GET")) return Reply.ok(store.tx(tx->{maintenance(tx);return tx.require("ALLOCATION",id);}));
            if(r.method.equals("DELETE")) {
                store.tx(tx->{
                    var a=tx.get("ALLOCATION",id);if(a==null) return null;
                    require(!Json.str(a,"state").equals("COMMITTED"),409,"ALREADY_ISSUED","No puede liberar un préstamo entregado.");
                    for(var item:Json.rows(a.get("items"))) {var copy=tx.require("COPY",Json.str(item,"copyId"));if(id.equals(copy.get("holdId"))) {copy.put("state","AVAILABLE");copy.remove("holdId");copy.remove("readyAt");tx.put("COPY",copy);}}
                    a.put("state","RELEASED");tx.put("ALLOCATION",a);return null;
                });return Reply.ok(Json.map("released",true));
            }
        }
        if(r.path.equals("/return")&&r.method.equals("POST")) {
            r.callers("orders");var b=r.json();Validation.fields(b,"copyId","loanId","returnedAt");
            String id=Validation.text(b,"copyId",1,80),loan=Validation.text(b,"loanId",1,100);
            Instant returned;try {returned=Instant.parse(Validation.text(b,"returnedAt",20,40));}catch(DateTimeException e){throw new Problem(400,"VALIDATION","Hora de devolución inválida.");}
            require(!returned.isAfter(now().plusSeconds(60)),400,"VALIDATION","La devolución no puede estar en el futuro.");
            var result=store.tx(tx->{
                var copy=tx.require("COPY",id);
                if(loan.equals(copy.get("lastReturnLoanId"))) return copy;
                require(Set.of("HOME","ROOM").contains(Json.str(copy,"state"))&&loan.equals(copy.get("loanId")),409,"LOAN_MISMATCH","Ejemplar no asociado al préstamo.");
                copy.put("state","RESHELVING");copy.put("readyAt",Policies.ready(returned).toString());copy.put("lastReturnLoanId",loan);
                copy.remove("loanId");copy.remove("dueAt");tx.put("COPY",copy);return copy;
            });return Reply.ok(Json.map("copyId",id,"state",result.get("state"),"readyAt",result.get("readyAt")));
        }
        if(r.path.equals("/reserve")&&r.method.equals("POST")) {
            r.callers("orders");r.user.roles("READER");var b=r.json();Validation.fields(b,"reservationId","readerId","copyId","date","mode");
            String reservation=Validation.text(b,"reservationId",1,100),owner=Validation.text(b,"readerId",1,100),copyId=Validation.text(b,"copyId",1,80);
            r.user.owner(owner);var day=Validation.date(b,clock);String mode=Validation.mode(b),key=copyId+"_"+day;
            var result=store.tx(tx->{
                maintenance(tx);var old=tx.get("RESERVATION",key);
                if(old!=null&&Json.str(old,"state").equals("ACTIVE")) {
                    require(reservation.equals(old.get("reservationId")),409,"RESERVATION_CONFLICT","Ese ejemplar ya está reservado ese día.");return old;
                }
                var copy=tx.require("COPY",copyId);var doc=tx.require("DOCUMENT",Json.str(copy,"documentId"));
                require(!Json.str(copy,"state").equals("RETIRED")&&Json.str(doc,"state").equals("ACTIVE"),409,"COPY_UNAVAILABLE","Ejemplar retirado.");
                if(day.equals(now().atZone(Policies.ZONE).toLocalDate())) require(Json.str(copy,"state").equals("AVAILABLE"),409,"COPY_UNAVAILABLE","Ejemplar no disponible hoy.");
                if(Set.of("HOME","ROOM").contains(Json.str(copy,"state"))) require(Instant.parse(Json.str(copy,"dueAt")).atZone(Policies.ZONE).toLocalDate().isBefore(day),409,"RESERVATION_CONFLICT","El préstamo vigente invade la fecha.");
                var row=Json.map("id",key,"reservationId",reservation,"ownerId",owner,"state","ACTIVE","copyId",copyId,"documentId",doc.get("id"),"date",day.toString(),"mode",mode);
                tx.put("RESERVATION",row);return row;
            });return Reply.created(result);
        }
        if(r.path.startsWith("/reservations/")&&r.method.equals("DELETE")) {
            r.callers("orders");String id=r.id("/reservations/");
            store.tx(tx->{for(var row:tx.list("RESERVATION")) if(id.equals(row.get("reservationId"))) {r.user.owner(Json.str(row,"ownerId"));row.put("state","CANCELLED");tx.put("RESERVATION",row);}return null;});
            return Reply.ok(Json.map("cancelled",true));
        }
        if(r.path.equals("/documents/batch")&&r.method.equals("POST")) {
            r.callers("graphql");var b=r.json();Validation.fields(b,"ids");
            require(b.get("ids") instanceof List<?> ids&&ids.size()<=100&&ids.stream().allMatch(x->x instanceof String s&&s.matches("[A-Za-z0-9_-]{1,80}")),400,"BATCH_LIMIT","Máximo cien identificadores.");
            var result=store.read(tx->{var copies=tx.list("COPY");var rows=new ArrayList<Map<String,Object>>();for(Object id:(List<?>)b.get("ids")){var doc=tx.get("DOCUMENT",id.toString());if(doc!=null) rows.add(publicDocument(doc,copies));}return rows;});
            return Reply.ok(Json.map("items",result));
        }
        r.callers("gateway");
        if(r.path.startsWith("/exit-check/")&&r.method.equals("GET")) {
            r.user.roles("LIBRARIAN");var copy=store.read(tx->tx.require("COPY",r.id("/exit-check/")));
            return Reply.ok(Json.map("copyId",copy.get("id"),"allowExit",Json.str(copy,"state").equals("HOME")&&!Json.str(copy,"loanId").isBlank(),"adapter","SOFTWARE_TEST_NO_PHYSICAL_RFID"));
        }
        if(r.path.equals("/documents")) {
            if(r.method.equals("GET")) {
                return Reply.ok(catalogue(r));
            }
            if(r.method.equals("POST")) {
                r.user.roles("LIBRARIAN");var b=r.json();var doc=documentBody(b,"d-"+UUID.randomUUID());
                var result=store.tx(tx->{tx.put("DOCUMENT",doc);if(b.containsKey("stock")) resizeStock(tx,doc,Json.integer(b,"stock",0));return publicDocument(doc,tx.list("COPY"));});
                return Reply.created(result);
            }
        }
        if(r.path.matches("/documents/[A-Za-z0-9_-]+/copies")&&r.method.equals("POST")) {
            r.user.roles("LIBRARIAN");String id=r.path.split("/")[2];var b=r.json();Validation.fields(b,"code","shelf");
            String code=Validation.text(b,"code",3,40);require(code.matches("[A-Z0-9-]+"),400,"VALIDATION","Código: A-Z, 0-9 y guión.");
            var copy=store.tx(tx->{var doc=tx.require("DOCUMENT",id);require(Json.str(doc,"state").equals("ACTIVE"),409,"ARCHIVED","Documento archivado.");
                require(tx.get("COPY",code)==null,409,"COPY_EXISTS","Código de ejemplar ya registrado.");
                var x=Json.map("id",code,"documentId",id,"state","AVAILABLE","shelf",Validation.text(b,"shelf",1,40));tx.put("COPY",x);return x;});
            return Reply.created(copy);
        }
        if(r.path.startsWith("/documents/")) {
            String id=r.id("/documents/");
            if(r.method.equals("GET")) return Reply.ok(store.read(tx->{var doc=tx.require("DOCUMENT",id);require(Json.str(doc,"state").equals("ACTIVE"),404,"NOT_FOUND","Documento no publicado.");return publicDocument(doc,tx.list("COPY"));}));
            r.user.roles("LIBRARIAN");
            if(r.method.equals("PUT")) {
                var b=r.json();var replacement=documentBody(b,id);
                var result=store.tx(tx->{
                    var old=tx.require("DOCUMENT",id);
                    require(Json.str(old,"state").equals("ACTIVE"),409,"ARCHIVED","Documento archivado.");
                    // Compatibilidad con clientes previos que no conocen descripción.
                    if(!b.containsKey("description")) replacement.put("description",Json.str(old,"description"));
                    tx.put("DOCUMENT",replacement);
                    if(b.containsKey("stock")) resizeStock(tx,replacement,Json.integer(b,"stock",0));
                    return publicDocument(replacement,tx.list("COPY"));
                });
                return Reply.ok(result);
            }
            if(r.method.equals("DELETE")) {
                store.tx(tx->{
                    var doc=tx.require("DOCUMENT",id);
                    var copies=tx.list("COPY").stream().filter(c->id.equals(c.get("documentId"))).toList();
                    require(copies.stream().allMatch(c->Set.of("AVAILABLE","RETIRED").contains(Json.str(c,"state"))),409,"DOCUMENT_IN_USE","No se archiva material prestado o retenido.");
                    require(tx.find("RESERVATION",null,"ACTIVE","",20000).stream().noneMatch(x->id.equals(x.get("documentId"))),409,"DOCUMENT_RESERVED","Documento con reservas activas.");
                    for(var copy:copies){copy.put("state","RETIRED");tx.put("COPY",copy);}doc.put("state","ARCHIVED");tx.put("DOCUMENT",doc);return null;
                });return Reply.ok(Json.map("id",id,"state","ARCHIVED"));
            }
        }
        if(r.path.startsWith("/copies/")) {
            r.user.roles("LIBRARIAN");String id=r.id("/copies/");
            if(r.method.equals("PUT")) {
                var b=r.json();Validation.fields(b,"shelf");String shelf=Validation.text(b,"shelf",1,40);
                return Reply.ok(store.tx(tx->{var copy=tx.require("COPY",id);require(!Json.str(copy,"state").equals("RETIRED"),409,"RETIRED","Ejemplar retirado.");copy.put("shelf",shelf);tx.put("COPY",copy);return copy;}));
            }
            if(r.method.equals("DELETE")) {
                store.tx(tx->{var copy=tx.require("COPY",id);require(Set.of("AVAILABLE","RETIRED").contains(Json.str(copy,"state")),409,"COPY_IN_USE","Ejemplar no disponible para retiro.");
                    require(tx.find("RESERVATION",null,"ACTIVE","",20000).stream().noneMatch(x->id.equals(x.get("copyId"))),409,"COPY_RESERVED","Ejemplar con reserva.");
                    copy.put("state","RETIRED");tx.put("COPY",copy);return null;});
                return Reply.ok(Json.map("id",id,"state","RETIRED"));
            }
        }
        throw new Problem(404,"NOT_FOUND","Operación de inventario no publicada.");
    }
    private void maintenance(Store.Tx tx) {
        if(store.oracle) {tx.procedure("bec_tick_inventory",now().toString());return;}
        for(var c:tx.list("COPY")) if(Json.str(c,"state").equals("RESHELVING")&&!Instant.parse(Json.str(c,"readyAt")).isAfter(now())) {
            c.put("state","AVAILABLE");c.remove("readyAt");tx.put("COPY",c);
        }
        for(var a:tx.find("ALLOCATION",null,"HELD","",20000)) if(!Instant.parse(Json.str(a,"expiresAt")).isAfter(now())) {
            for(var item:Json.rows(a.get("items"))) {var c=tx.require("COPY",Json.str(item,"copyId"));if(a.get("id").equals(c.get("holdId"))) {c.put("state","AVAILABLE");c.remove("holdId");c.remove("readyAt");tx.put("COPY",c);}}
            a.put("state","EXPIRED");tx.put("ALLOCATION",a);
        }
        LocalDate today=now().atZone(Policies.ZONE).toLocalDate();
        for(var res:tx.find("RESERVATION",null,"ACTIVE","",20000)) if(LocalDate.parse(Json.str(res,"date")).isBefore(today)) {res.put("state","EXPIRED");tx.put("RESERVATION",res);}
    }
    @Override protected void tick() {store.tx(tx->{maintenance(tx);return null;});}
}
