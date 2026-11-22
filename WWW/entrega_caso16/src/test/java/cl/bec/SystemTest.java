package cl.bec;

import org.junit.jupiter.api.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

/** HTTP/TLS reales, diez listeners, siete repositorios privados H2 EN ARCHIVO. */
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SystemTest {
    static Path runtime;
    static final Map<String,Node> nodes=new LinkedHashMap<>();
    static final MutableClock clock=new MutableClock(Instant.parse("2026-11-18T13:00:00Z"));
    static HttpClient http;
    static String base,admin,bib,reader,reader2,readerId,reader2Id,homeLoan,roomLoan;
    static Map<String,Object> credentials;
    static final String PHOTO="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1kAAAAASUVORK5CYII=";
    record Result(int status,Map<String,Object> data) {}
    static class MutableClock extends Clock {
        private final AtomicReference<Instant> time;
        MutableClock(Instant now) {time=new AtomicReference<>(now);}
        public ZoneId getZone(){return ZoneOffset.UTC;}
        public Clock withZone(ZoneId zone){return Clock.fixed(instant(),zone);}
        public Instant instant(){return time.get();}
        void set(Instant now){time.set(now);}
        void advance(Duration duration){time.updateAndGet(t->t.plus(duration));}
    }
    @BeforeAll static void start() throws Exception {
        runtime=Path.of(System.getProperty("java.io.tmpdir"),"bec-junit-"+UUID.randomUUID());
        int port=22000+new Random().nextInt(500)*10;
        Process p=new ProcessBuilder("python3","scripts/setup.py","--runtime",runtime.toString(),"--base-port",""+port,"--gateway-port",""+(port+9),"--test").inheritIO().start();
        assertEquals(0,p.waitFor());
        Files.createDirectories(Path.of("target"));Files.writeString(Path.of("target/test-runtime.txt"),runtime.toString());
        for(String name:List.of("secrets","auth","clients","inventory","orders","payments","notifications","graphql","mail","gateway")) restart(name);
        var gateway=nodes.get("gateway");
        http=HttpClient.newBuilder().sslContext(gateway.config.tls).connectTimeout(Duration.ofSeconds(3)).build();
        base="https://localhost:"+gateway.config.port();
        credentials=Json.object(Files.readString(runtime.resolve("demo-credentials.json")));
        refresh();
        readerId=register("12345678-5","lector","fingerprint");
        reader2Id=register("11111111-1","lector2","fingerprint2");
        activateAll();refreshReaders();
        addDocument("Atlas de la ciudad",3,"B001","B002");
        addDocument("Tecnología comunitaria",7,"T001","T002");
        addDocument("Memoria audiovisual",2,"V001","V002");
    }
    static void restart(String name) throws Exception {
        var old=nodes.remove(name);if(old!=null)old.close();
        Node node=Main.create(new Config(runtime,name),clock);node.start();nodes.put(name,node);
    }
    @AfterAll static void stop() {var list=new ArrayList<>(nodes.values());Collections.reverse(list);list.forEach(Node::close);}
    @SuppressWarnings("unchecked") static Map<String,Object> credential(String role){return (Map<String,Object>)credentials.get(role);}
    static String login(String role) throws Exception {
        var result=req("POST","/auth/login",credential(role),null,null);
        assertEquals(200,result.status,Json.write(result.data));return Json.str(result.data,"token");
    }
    static void refresh() throws Exception {admin=login("admin");bib=login("bibliotecario");}
    static void refreshReaders() throws Exception {reader=login("lector");reader2=login("lector2");}
    static Result req(String method,String path,Object body,String token,String key) throws Exception {
        var b=HttpRequest.newBuilder(URI.create(base+"/api"+path)).timeout(Duration.ofSeconds(12)).header("Content-Type","application/json");
        if(token!=null)b.header("Authorization","Bearer "+token);
        if(key!=null)b.header("Idempotency-Key",key);
        var response=http.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(Json.write(body))).build(),HttpResponse.BodyHandlers.ofString());
        return new Result(response.statusCode(),Json.object(response.body()));
    }
    static String register(String rut,String role,String fingerprint) throws Exception {
        var c=credential(role);
        var b=Json.map("rut",rut,"names","Persona Ficticia","surnames",role,"address","Dirección ficticia 100, Estación Central",
            "email",c.get("email"),"telephone","+56900000000","photo",PHOTO,"fingerprint",credentials.get(fingerprint),
            "password",c.get("password"),"documentsChecked",true);
        var result=req("POST","/readers",b,admin,null);
        assertEquals(201,result.status,Json.write(result.data));return Json.str(result.data,"id");
    }
    static void pump() {for(String n:List.of("clients","auth","inventory","orders","notifications","mail"))if(nodes.containsKey(n))nodes.get(n).safeTick();}
    static void activateAll() throws Exception {
        for(int attempt=0;attempt<30;attempt++) {
            pump();
            var mailbox=req("GET","/lab/mailbox?size=20",null,admin,null);
            for(var mail:Json.rows(mailbox.data.get("items"))) {
                var match=java.util.regex.Pattern.compile("\\?activation=([A-Za-z0-9_-]{43})").matcher(Json.str(mail,"text"));
                if(match.find()) {var result=req("POST","/auth/activate",Json.map("token",match.group(1)),null,null);assertTrue(Set.of(200,409).contains(result.status));}
            }
            if(nodes.get("clients").store.read(tx->tx.list("READER")).stream().allMatch(r->Json.str(r,"state").equals("ACTIVE")))return;
            Thread.sleep(25);
        }
        fail("La cola de activación no se completó");
    }
    static String addDocument(String title,int days,String... codes) throws Exception {
        var body=Json.map("title",title,"author","Autor Ficticio","type","BOOK","medium","PAPER","publisher","Editorial Demo","edition","1","year",2026,"shelf","A-1","category","Comunidad","homeDays",days,"roomHours",3);
        var doc=req("POST","/documents",body,bib,null);assertEquals(201,doc.status,Json.write(doc.data));String id=Json.str(doc.data,"id");
        for(String code:codes)assertEquals(201,req("POST","/documents/"+id+"/copies",Json.map("code",code,"shelf","A-1"),bib,null).status);
        return id;
    }
    static Map<String,Object> request(String token,String mode,String... copies) throws Exception {
        var result=req("POST","/requests",Json.map("copyIds",List.of(copies),"mode",mode),token,UUID.randomUUID().toString());
        assertEquals(201,result.status,Json.write(result.data));return result.data;
    }
    static Result issue(Map<String,Object> request,String rut,String finger) throws Exception {
        return req("POST","/requests/"+request.get("id")+"/issue",Json.map("rut",rut,"fingerprint",credentials.get(finger)),bib,null);
    }
    static Map<String,Object> copy(String code) {
        return nodes.get("inventory").store.read(tx->tx.require("COPY",code));
    }
    static String error(Result r) {
        @SuppressWarnings("unchecked") var e=(Map<String,Object>)r.data.get("error");return Json.str(e,"code");
    }
    @Test @Order(1) void T01_catalogoAnonimoYAllowlist() throws Exception {
        var result=req("GET","/catalog?q=ciudad&size=10&page=0",null,null,null);
        assertEquals(200,result.status);assertEquals(1,Json.integer(result.data,"total",0));
        assertEquals(2,Json.integer(Json.rows(result.data.get("items")).getFirst(),"available",0));
        assertEquals(405,req("PUT","/catalog",Json.map(),null,null).status);
        assertEquals(404,req("GET","/admin/proxy?target=orders",null,null,null).status);
        assertEquals(400,req("GET","/catalog?size=21",null,null,null).status);
        assertEquals(400,req("GET","/catalog?q=a&q=b",null,null,null).status);
        var response=http.send(HttpRequest.newBuilder(URI.create(base+"/")).GET().build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(200,response.statusCode());assertTrue(response.headers().firstValue("Content-Security-Policy").orElse("").contains("frame-ancestors 'none'"));
    }
    @Test @Order(2) void T02_sesionRolYBackendDirecto() throws Exception {
        assertEquals(401,req("GET","/loans",null,null,null).status);
        assertEquals(403,req("GET","/overdue",null,reader,null).status);
        assertEquals(403,req("POST","/documents",Json.map(),reader,null).status);
        assertEquals(401,req("GET","/loans",null,"token-invalido",null).status);
        var request=HttpRequest.newBuilder(URI.create("https://localhost:"+nodes.get("orders").config.port()+"/loans"))
            .header("X-Role","ADMIN").header("X-User-Context",new Principal(readerId,"ADMIN").encoded()).GET().build();
        assertEquals(403,http.send(request,HttpResponse.BodyHandlers.ofString()).statusCode());
        assertThrows(Problem.class,()->nodes.get("gateway").rpc("inventory","POST","/documents",Json.map(),new Principal(readerId,"READER"),UUID.randomUUID().toString()));
    }
    @Test @Order(3) void T03_activacionUnicaLogoutYValidacion() throws Exception {
        var bad=Json.map("rut","12345678-0");assertEquals(400,req("POST","/readers",bad,admin,null).status);
        var c=credential("lector");
        var result=req("POST","/auth/login",Json.map("email",c.get("email"),"password","incorrecta"),null,null);assertEquals(401,result.status);
        String temporary=login("lector");assertEquals(200,req("GET","/auth/me",null,temporary,null).status);
        assertEquals(200,req("POST","/auth/logout",Json.map(),temporary,null).status);
        assertEquals(401,req("GET","/auth/me",null,temporary,null).status);
        var mailbox=req("GET","/lab/mailbox?size=20",null,admin,null);
        String text=Json.str(Json.rows(mailbox.data.get("items")).getFirst(),"text");
        String token=text.substring(text.indexOf("?activation=")+12);
        assertEquals(409,req("POST","/auth/activate",Json.map("token",token),null,null).status);
        assertEquals(400,req("POST","/auth/activate",Json.map("token",Crypto.random()),null,null).status);
        assertEquals(403,req("GET","/readers/"+reader2Id,null,reader,null).status);
        assertEquals(200,req("GET","/readers?q=Persona&size=20",null,admin,null).status);
        assertEquals(200,req("PUT","/readers/"+readerId,Json.map("address","Dirección actualizada ficticia 200","telephone","+56900000001","photo",PHOTO),admin,null).status);
        var privateRow=nodes.get("clients").store.read(tx->tx.require("READER",readerId));
        assertFalse(Json.write(privateRow).contains("12345678-5"));assertFalse(Json.write(privateRow).contains("Dirección"));
    }
    @Test @Order(4) void T04_CRUDColeccionSinBorradoHistorico() throws Exception {
        String id=addDocument("Documento retirable",1,"X001");
        var detail=req("GET","/catalog/"+id,null,null,null);assertEquals(200,detail.status);
        var replacement=new LinkedHashMap<>(detail.data);for(String k:List.of("id","state","available","inRoom","total","copies"))replacement.remove(k);
        replacement.put("title","Documento corregido");assertEquals(200,req("PUT","/documents/"+id,replacement,bib,null).status);
        replacement.put("homeDays",-1);assertEquals(400,req("PUT","/documents/"+id,replacement,bib,null).status);
        assertEquals(200,req("PUT","/copies/X001",Json.map("shelf","B-9"),bib,null).status);
        assertEquals(200,req("DELETE","/copies/X001",null,bib,null).status);
        assertEquals(200,req("DELETE","/documents/"+id,null,bib,null).status);
        assertEquals(404,req("GET","/catalog/"+id,null,null,null).status);
        assertNotNull(nodes.get("inventory").store.read(tx->tx.get("DOCUMENT",id)));
    }
    @Test @Order(5) void T05_carreraAtomicaIdempotenciaYTitularidad() throws Exception {
        String k=UUID.randomUUID().toString();var b=Json.map("copyIds",List.of("B001"),"mode","HOME");
        try(var executor=Executors.newFixedThreadPool(2)) {
            var a=executor.submit(()->req("POST","/requests",b,reader,k));
            var c=executor.submit(()->req("POST","/requests",b,reader2,UUID.randomUUID().toString()));
            Result one=a.get(),two=c.get();assertEquals(Set.of(201,409),Set.of(one.status,two.status));
            var winner=one.status==201?one:two;String owner=one.status==201?reader:reader2;
            if(one.status==201) {
                assertEquals(Json.str(one.data,"id"),Json.str(req("POST","/requests",b,reader,k).data,"id"));
                assertEquals(409,req("POST","/requests",Json.map("copyIds",List.of("B002"),"mode","HOME"),reader,k).status);
            }
            String other=one.status==201?reader2:reader;
            assertEquals(403,req("DELETE","/requests/"+winner.data.get("id"),null,other,null).status);
            assertEquals(409,req("POST","/requests",Json.map("copyIds",List.of("B001","B002"),"mode","HOME"),other,UUID.randomUUID().toString()).status);
            assertEquals("AVAILABLE",copy("B002").get("state"));
            assertEquals(200,req("DELETE","/requests/"+winner.data.get("id"),null,owner,null).status);
            assertEquals("AVAILABLE",copy("B001").get("state"));
        }
    }
    @Test @Order(6) void T06_reservaFechaConflictoYCancelacion() throws Exception {
        String date=clock.instant().atZone(Policies.ZONE).toLocalDate().plusDays(1).toString(),k=UUID.randomUUID().toString();
        var b=Json.map("copyId","B001","date",date,"mode","HOME");
        var reserve=req("POST","/reservations",b,reader,k);assertEquals(201,reserve.status,Json.write(reserve.data));
        assertEquals(reserve.data.get("id"),req("POST","/reservations",b,reader,k).data.get("id"));
        assertEquals(409,req("POST","/reservations",b,reader2,UUID.randomUUID().toString()).status);
        assertEquals(409,req("POST","/requests",Json.map("copyIds",List.of("B001"),"mode","HOME"),reader2,UUID.randomUUID().toString()).status);
        assertEquals(403,req("DELETE","/reservations/"+reserve.data.get("id"),null,reader2,null).status);
        assertEquals(200,req("DELETE","/reservations/"+reserve.data.get("id"),null,reader,null).status);
    }
    @Test @Order(7) void T07_entregaIdentidadComprobanteYSalida() throws Exception {
        assertEquals(false,req("GET","/exit-check/B001",null,bib,null).data.get("allowExit"));
        var q=request(reader,"HOME","B001","T001");
        var wrong=issue(q,"11111111-1","fingerprint");assertEquals(403,wrong.status);
        var issued=issue(q,"12345678-5","fingerprint");assertEquals(200,issued.status,Json.write(issued.data));homeLoan=Json.str(issued.data,"id");
        var items=Json.rows(issued.data.get("items"));assertNotEquals(items.get(0).get("dueAt"),items.get(1).get("dueAt"));
        assertEquals(homeLoan,issue(q,"12345678-5","fingerprint").data.get("id"));
        assertEquals(200,req("GET","/loans/"+homeLoan+"/receipt",null,reader,null).status);
        assertEquals(403,req("GET","/loans/"+homeLoan,null,reader2,null).status);
        assertEquals(403,req("GET","/loans/"+homeLoan+"/receipt",null,reader2,null).status);
        assertEquals(409,req("DELETE","/requests/"+q.get("id"),null,reader,null).status);
        assertEquals(true,req("GET","/exit-check/B001",null,bib,null).data.get("allowExit"));
        String doc=Json.str(copy("B001"),"documentId");assertEquals(409,req("DELETE","/documents/"+doc,null,bib,null).status);
    }
    @Test @Order(8) void T08_GraphQLAgregadoCamposLimitesYPropiedad() throws Exception {
        String query="{account{reader{id email}loans{id items{title document{author}}assessment{amount state}}totalLoans}}";
        var result=req("POST","/graphql",Json.map("query",query),reader,null);
        assertEquals(200,result.status);assertFalse(result.data.containsKey("errors"),Json.write(result.data));assertTrue(Json.write(result.data).contains("EXEMPT"));
        var denied=req("POST","/graphql",Json.map("query","{account(readerId:\""+reader2Id+"\"){reader{id}}}"),reader,null);
        assertTrue(Json.write(denied.data).contains("RESOURCE_FORBIDDEN"));
        var administrative=req("POST","/graphql",Json.map("query","{account(readerId:\""+readerId+"\"){reader{id email}reservations{id}totalLoans}}"),admin,null);
        assertFalse(administrative.data.containsKey("errors"),Json.write(administrative.data));
        assertEquals(403,req("GET","/reservations?readerId="+readerId,null,admin,null).status);
        var field=req("POST","/graphql",Json.map("query","{account(readerId:\""+readerId+"\"){reader{id email}}}"),bib,null);
        assertTrue(Json.write(field.data).contains("FIELD_FORBIDDEN"));assertFalse(Json.write(field.data).contains(credential("lector").get("email").toString()));
        assertTrue(req("POST","/graphql",Json.map("query","{__schema{types{name}}}"),reader,null).data.containsKey("errors"));
        assertTrue(req("POST","/graphql",Json.map("query","{account(first:21){totalLoans}}"),reader,null).data.containsKey("errors"));
        String aliases="{"+java.util.stream.IntStream.range(0,110).mapToObj(i->"a"+i+":account{totalLoans}").collect(java.util.stream.Collectors.joining(" "))+"}";
        assertTrue(req("POST","/graphql",Json.map("query",aliases),reader,null).data.containsKey("errors"));
        nodes.get("inventory").close();nodes.remove("inventory");
        try {
            var partial=req("POST","/graphql",Json.map("query",query),reader,null);
            assertTrue(partial.data.containsKey("errors"));assertTrue(Json.write(partial.data).contains("EXEMPT"));assertTrue(Json.write(partial.data).contains("DEPENDENCY_UNAVAILABLE"));
        } finally {restart("inventory");}
    }
    @Test @Order(9) void T09_pagoManipuladoYFirmaAntireplay() throws Exception {
        var before=nodes.get("payments").store.read(tx->tx.list("ASSESSMENT"));
        var tampered=req("POST","/payments/intents",Json.map("loanId",homeLoan,"amount",1,"currency","CLP","paymentStatus","PAID"),reader,null);
        assertEquals(422,tampered.status);assertEquals("NO_MONETARY_PAYMENTS",error(tampered));
        assertEquals(before,nodes.get("payments").store.read(tx->tx.list("ASSESSMENT")));
        assertEquals(200,req("GET","/payments/assessments/"+homeLoan,null,reader,null).status);
        assertEquals(403,req("GET","/payments/assessments/"+homeLoan,null,reader2,null).status);
        Node gateway=nodes.get("gateway");String path="/documents";var headers=gateway.identity.sign("inventory","GET",path,"",Principal.ANONYMOUS);
        var b=HttpRequest.newBuilder(URI.create("https://localhost:"+nodes.get("inventory").config.port()+path));headers.forEach(b::header);
        var signed=b.GET().build();assertEquals(200,http.send(signed,HttpResponse.BodyHandlers.ofString()).statusCode());assertEquals(403,http.send(signed,HttpResponse.BodyHandlers.ofString()).statusCode());
        var spoof=HttpRequest.newBuilder(URI.create(base+"/api/overdue")).header("Authorization","Bearer "+reader).header("X-Service","orders").header("X-Role","ADMIN").GET().build();
        assertEquals(403,http.send(spoof,HttpResponse.BodyHandlers.ofString()).statusCode());
    }
    @Test @Order(10) void T10_salaNoSaleYVenceMismoDia() throws Exception {
        var q=request(reader2,"ROOM","V001");var issue=issue(q,"11111111-1","fingerprint2");assertEquals(200,issue.status);
        roomLoan=Json.str(issue.data,"id");var item=Json.rows(issue.data.get("items")).getFirst();
        assertEquals(clock.instant().atZone(Policies.ZONE).toLocalDate(),Instant.parse(Json.str(item,"dueAt")).atZone(Policies.ZONE).toLocalDate());
        assertEquals(false,req("GET","/exit-check/V001",null,bib,null).data.get("allowExit"));
        assertEquals(409,req("GET","/loans/"+roomLoan+"/receipt",null,reader2,null).status);
        var doc=req("GET","/catalog/"+copy("V001").get("documentId"),null,null,null);
        assertEquals(1,Json.integer(doc.data,"inRoom",0));
        clock.set(Instant.parse(Json.str(item,"dueAt")).plusSeconds(1));refresh();refreshReaders();
        assertEquals(1,Json.integer(req("GET","/overdue?mode=ROOM",null,admin,null).data,"total",0));
    }
    @Test @Order(11) void T11_devolucionSancionYBufferExacto() throws Exception {
        assertEquals(409,req("POST","/requests",Json.map("copyIds",List.of("V002"),"mode","ROOM"),reader2,UUID.randomUUID().toString()).status);
        String k=UUID.randomUUID().toString();
        var ret=req("POST","/returns",Json.map("copyId","V001"),bib,k);assertEquals(200,ret.status);
        assertEquals(true,ret.data.get("late"));assertEquals("RESHELVING",copy("V001").get("state"));
        assertEquals(ret.data.get("id"),req("POST","/returns",Json.map("copyId","V001"),bib,k).data.get("id"));
        assertEquals(409,req("POST","/requests",Json.map("copyIds",List.of("V002"),"mode","ROOM"),reader2,UUID.randomUUID().toString()).status);
        clock.advance(Duration.ofSeconds(1799));pump();assertEquals("RESHELVING",copy("V001").get("state"));
        clock.advance(Duration.ofSeconds(1));pump();assertEquals("AVAILABLE",copy("V001").get("state"));
        refresh();refreshReaders();assertEquals(0,Json.integer(req("GET","/overdue?mode=ROOM",null,admin,null).data,"total",0));
    }
    @Test @Order(12) void T12_recordatorioDiarioSancionExpira() throws Exception {
        var loan=nodes.get("orders").store.read(tx->tx.require("LOAN",homeLoan));
        Instant latest=Json.rows(loan.get("items")).stream().map(i->Instant.parse(Json.str(i,"dueAt"))).max(Instant::compareTo).orElseThrow();
        clock.set(latest.plusSeconds(60));refresh();refreshReaders();pump();pump();
        var mail=nodes.get("mail").store.read(tx->tx.list("MAIL"));
        long count=mail.stream().filter(x->Json.str(x,"id").startsWith("overdue-"+homeLoan)).count();assertEquals(1,count);
        pump();assertEquals(1,nodes.get("mail").store.read(tx->tx.list("MAIL")).stream().filter(x->Json.str(x,"id").startsWith("overdue-"+homeLoan)).count());
        assertEquals(2,Json.integer(req("GET","/overdue?mode=HOME",null,admin,null).data,"total",0));
        assertEquals(200,req("POST","/returns",Json.map("copyId","B001"),bib,UUID.randomUUID().toString()).status);
        assertEquals(200,req("POST","/returns",Json.map("copyId","T001"),bib,UUID.randomUUID().toString()).status);
        assertEquals(409,req("POST","/requests",Json.map("copyIds",List.of("B002"),"mode","HOME"),reader,UUID.randomUUID().toString()).status);
        var sanction=nodes.get("orders").store.read(tx->tx.require("SANCTION",readerId));clock.set(Instant.parse(Json.str(sanction,"until")).plusSeconds(1));
        pump();refresh();refreshReaders();var q=request(reader,"HOME","B002");assertEquals(200,req("DELETE","/requests/"+q.get("id"),null,reader,null).status);
    }
    @Test @Order(13) void T13_sagaEntregaRecuperaCaidaPagos() throws Exception {
        var q=request(reader,"HOME","B002");
        nodes.remove("payments").close();
        var issue=issue(q,"12345678-5","fingerprint");assertEquals(502,issue.status);
        var persisted=nodes.get("orders").store.read(tx->tx.require("REQUEST",Json.str(q,"id")));assertEquals("ISSUING",persisted.get("state"));
        assertEquals("HOME",copy("B002").get("state"));
        assertEquals(409,req("DELETE","/requests/"+q.get("id"),null,reader,null).status);
        restart("payments");pump();pump();
        var finished=nodes.get("orders").store.read(tx->tx.require("REQUEST",Json.str(q,"id")));assertEquals("ISSUED",finished.get("state"));
        assertEquals(1,nodes.get("payments").store.read(tx->tx.list("ASSESSMENT")).stream().filter(a->finished.get("loanId").equals(a.get("id"))).count());
        assertEquals(200,req("POST","/returns",Json.map("copyId","B002"),bib,UUID.randomUUID().toString()).status);
    }
    @Test @Order(14) void T14_fallaInventarioSolicitudYDevolucionRecuperables() throws Exception {
        String k=UUID.randomUUID().toString();var b=Json.map("copyIds",List.of("T002"),"mode","HOME");
        nodes.remove("inventory").close();assertEquals(502,req("POST","/requests",b,reader,k).status);
        restart("inventory");pump();
        var q=req("POST","/requests",b,reader,k);assertEquals(201,q.status);assertEquals("PENDING",q.data.get("state"));
        var issued=issue(q.data,"12345678-5","fingerprint");assertEquals(200,issued.status);
        nodes.remove("inventory").close();String rk=UUID.randomUUID().toString();
        assertEquals(502,req("POST","/returns",Json.map("copyId","T002"),bib,rk).status);
        restart("inventory");pump();
        var ret=req("POST","/returns",Json.map("copyId","T002"),bib,rk);assertEquals(200,ret.status);assertEquals("RETURNED",ret.data.get("state"));assertEquals("RESHELVING",copy("T002").get("state"));
    }
    @Test @Order(15) void T15_caidaSecretosCierraYAlcanceDenegado() throws Exception {
        var gateway=nodes.get("gateway");
        var req=HttpRequest.newBuilder(URI.create("https://localhost:"+nodes.get("secrets").config.port()+"/v1/secrets/orders"))
            .header("Authorization","Bearer "+Json.str(gateway.config.bootstrap,"bootstrapToken")).GET().build();
        assertEquals(403,http.send(req,HttpResponse.BodyHandlers.ofString()).statusCode());
        nodes.remove("secrets").close();
        try {assertEquals(503,req("GET","/catalog",null,null,null).status);}
        finally {restart("secrets");}
        assertEquals(200,req("GET","/catalog",null,null,null).status);
    }
    @Test @Order(16) void T16_correoReintentoYPersistenciaTrasReinicio() throws Exception {
        String doc=addDocument("Prueba persistente",1,"P001");
        nodes.remove("mail").close();
        var q=request(reader,"HOME","P001");var issued=issue(q,"12345678-5","fingerprint");assertEquals(200,issued.status);
        pump();var message=nodes.get("notifications").store.read(tx->tx.require("MESSAGE","receipt-"+issued.data.get("id")));assertEquals("PENDING",message.get("state"));
        restart("mail");clock.advance(Duration.ofMinutes(6));pump();pump();
        var delivered=nodes.get("notifications").store.read(tx->tx.require("MESSAGE","receipt-"+issued.data.get("id")));assertEquals("DELIVERED",delivered.get("state"));
        restart("inventory");assertEquals(200,req("GET","/catalog/"+doc,null,null,null).status);assertEquals("HOME",copy("P001").get("state"));
    }
    @Test @Order(17) void T17_vencimientoSesionYRetencion() throws Exception {
        refresh();refreshReaders();var q=request(reader2,"ROOM","V002");assertEquals("HELD",copy("V002").get("state"));
        clock.advance(Duration.ofMinutes(20));pump();
        assertEquals(401,req("GET","/loans",null,reader2,null).status);assertEquals("AVAILABLE",copy("V002").get("state"));
        assertEquals("EXPIRED",nodes.get("orders").store.read(tx->tx.require("REQUEST",Json.str(q,"id"))).get("state"));
    }
    static String activationFor(String email,String exclude) throws Exception {
        for(int attempt=0;attempt<30;attempt++) {
            pump();
            for(var message:Json.rows(req("GET","/lab/mailbox?size=20",null,admin,null).data.get("items"))) {
                var match=java.util.regex.Pattern.compile("\\?activation=([A-Za-z0-9_-]{43})").matcher(Json.str(message,"text"));
                if(email.equals(message.get("to"))&&match.find()&&!match.group(1).equals(exclude))return match.group(1);
            }
            Thread.sleep(25);
        }
        throw new AssertionError("El proveedor no recibió la activación");
    }
    @Test @Order(18) void T18_activacionVencidaReenvioYCorreoUnico() throws Exception {
        refresh();refreshReaders();
        String password=Crypto.random(),email="caducidad@bec.example.invalid";
        var body=Json.map("rut","22222222-2","names","Tercera Ficticia","surnames","Prueba","address","Dirección de prueba 123",
            "email",email,"telephone","+56900000002","photo",PHOTO,"fingerprint",credentials.get("fingerprint"),"password",password,"documentsChecked",true);
        var registered=req("POST","/readers",body,admin,null);assertEquals(201,registered.status);String id=Json.str(registered.data,"id");
        String old=activationFor(email,"");
        assertEquals(401,req("POST","/auth/login",Json.map("email",email,"password",password),null,null).status);
        var duplicate=new LinkedHashMap<>(body);duplicate.put("rut","33333333-3");
        assertEquals(409,req("POST","/readers",duplicate,admin,null).status);
        clock.advance(Duration.ofHours(25));refresh();refreshReaders();
        assertEquals(410,req("POST","/auth/activate",Json.map("token",old),null,null).status);
        assertEquals(401,req("POST","/readers/"+id+"/activation",Json.map(),null,null).status);
        assertEquals(403,req("POST","/readers/"+id+"/activation",Json.map(),reader,null).status);
        assertEquals(200,req("POST","/readers/"+id+"/activation",Json.map(),admin,null).status);
        String renewed=activationFor(email,old);
        assertNotEquals(old,renewed);
        assertEquals(400,req("POST","/auth/activate",Json.map("token",old),null,null).status);
        assertEquals(200,req("POST","/auth/activate",Json.map("token",renewed),null,null).status);
        assertEquals(409,req("POST","/auth/activate",Json.map("token",renewed),null,null).status);
        assertEquals(409,req("POST","/readers/"+id+"/activation",Json.map(),admin,null).status);
        assertEquals(200,req("POST","/auth/login",Json.map("email",email,"password",password),null,null).status);
    }
    static Map<String,Object> mediaBody(String title,String type,String medium,int stock) {
        return Json.map("title",title,"author","Lucía Prueba","type",type,"medium",medium,"publisher","Editorial Ensayo",
            "edition","1","year",2026,"shelf","M-01","category","Colección Sonora","homeDays",3,"roomHours",2,
            "description","Primera línea.\nDescripción de prueba.","stock",stock);
    }
    @Test @Order(19) void T19_multimediaDigitalDescripcionYAltaAtomica() throws Exception {
        refresh();
        var body=mediaBody("Audio digital de prueba","AUDIO","DIGITAL",2);
        assertEquals(403,req("POST","/documents",body,admin,null).status);
        var created=req("POST","/documents",body,bib,null);assertEquals(201,created.status,Json.write(created.data));
        String id=Json.str(created.data,"id");
        assertEquals(2,Json.integer(created.data,"total",-1));
        assertEquals(2,Json.integer(created.data,"available",-1));
        assertEquals(2,Json.rows(created.data.get("copies")).size());
        var edited=new LinkedHashMap<>(body);edited.put("type","VIDEO");edited.put("medium","DVD");
        assertEquals(200,req("PUT","/documents/"+id,edited,bib,null).status);
        var saved=req("GET","/catalog/"+id,null,null,null).data;
        assertEquals("VIDEO",saved.get("type"));assertEquals("DVD",saved.get("medium"));
        assertEquals(body.get("description"),saved.get("description"));
        edited.put("medium","DIGITAL");assertEquals(200,req("PUT","/documents/"+id,edited,bib,null).status);
        for(String type:List.of("BOOK","TECHNICAL")) {
            var invalid=mediaBody("Incompatible",""+type,"DIGITAL",1);
            assertEquals(400,req("POST","/documents",invalid,bib,null).status);
        }
        assertEquals(400,req("POST","/documents",mediaBody("No papel en multimedia","AUDIO","PAPER",1),bib,null).status);
        assertEquals(400,req("POST","/documents",mediaBody("Stock negativo","AUDIO","CD",-1),bib,null).status);
        assertEquals(400,req("POST","/documents",mediaBody("Stock excesivo","VIDEO","DVD",201),bib,null).status);
        var noDescription=new LinkedHashMap<>(edited);noDescription.remove("description");noDescription.remove("stock");
        assertEquals(200,req("PUT","/documents/"+id,noDescription,bib,null).status);
        assertEquals(body.get("description"),req("GET","/catalog/"+id,null,null,null).data.get("description"));
        assertEquals(200,req("DELETE","/documents/"+id,null,bib,null).status);
    }
    @Test @Order(20) void T20_filtrosCombinadosAntesDePaginar() throws Exception {
        for(var body:List.of(mediaBody("Filtro Áudio Uno","AUDIO","DIGITAL",1),
                            mediaBody("Filtro Áudio Dos","VIDEO","DVD",0),
                            mediaBody("Filtro Áudio Libro","BOOK","PAPER",1)))
            assertEquals(201,req("POST","/documents",body,bib,null).status);
        String filters="/catalog?title=audio&author="+URLEncoder.encode("lucia",java.nio.charset.StandardCharsets.UTF_8)+
            "&type=MULTIMEDIA&publisher=ensayo&subcategory=sonora&size=1";
        var first=req("GET",filters+"&page=0",null,null,null);var second=req("GET",filters+"&page=1",null,null,null);
        assertEquals(200,first.status);assertEquals(2,Json.integer(first.data,"total",-1));
        assertEquals(1,Json.rows(first.data.get("items")).size());
        assertNotEquals(Json.rows(first.data.get("items")).getFirst().get("id"),Json.rows(second.data.get("items")).getFirst().get("id"));
        var available=req("GET",filters+"&availability=AVAILABLE",null,null,null);
        var unavailable=req("GET",filters+"&availability=UNAVAILABLE",null,null,null);
        assertEquals(1,Json.integer(available.data,"total",-1));assertEquals(1,Json.integer(unavailable.data,"total",-1));
        assertEquals("AUDIO",Json.rows(available.data.get("items")).getFirst().get("type"));
        assertEquals("VIDEO",Json.rows(unavailable.data.get("items")).getFirst().get("type"));
        assertEquals(0,Json.integer(req("GET",filters+"&availability=IN_ROOM",null,null,null).data,"total",-1));
        assertEquals(400,req("GET","/catalog?availability=OTRA",null,null,null).status);
        assertEquals(400,req("GET","/catalog?type=OTRO",null,null,null).status);
        assertEquals(400,req("GET","/catalog?filtroInventado=a",null,null,null).status);
    }
    @Test @Order(21) void T21_stockNoRetiraPrestadosYRollbackDeEdicion() throws Exception {
        refresh();refreshReaders();
        var body=mediaBody("Stock protegido","VIDEO","DIGITAL",2);
        var created=req("POST","/documents",body,bib,null);assertEquals(201,created.status);
        String id=Json.str(created.data,"id");
        String heldCopy=Json.str(Json.rows(created.data.get("copies")).getFirst(),"id");
        var pending=request(reader2,"ROOM",heldCopy);
        var changed=new LinkedHashMap<>(body);changed.put("stock",0);changed.put("title","NO DEBE GUARDARSE");
        var rejected=req("PUT","/documents/"+id,changed,bib,null);
        assertEquals(409,rejected.status);assertEquals("STOCK_IN_USE",error(rejected));
        var unchanged=req("GET","/catalog/"+id,null,null,null).data;
        assertEquals("Stock protegido",unchanged.get("title"));assertEquals(2,Json.integer(unchanged,"total",-1));
        assertEquals("HELD",copy(heldCopy).get("state"));
        assertEquals(409,req("DELETE","/documents/"+id,null,bib,null).status);
        assertEquals(200,req("DELETE","/requests/"+pending.get("id"),null,reader2,null).status);
        changed.put("title","Stock reducido");
        assertEquals(200,req("PUT","/documents/"+id,changed,bib,null).status);
        assertEquals(0,Json.integer(req("GET","/catalog/"+id,null,null,null).data,"total",-1));
        changed.put("stock",3);
        assertEquals(200,req("PUT","/documents/"+id,changed,bib,null).status);
        var expanded=req("GET","/catalog/"+id,null,null,null).data;
        assertEquals(3,Json.integer(expanded,"total",-1));
        assertEquals(3,Json.rows(expanded.get("copies")).stream().map(c->c.get("id")).distinct().count());
        assertEquals(200,req("DELETE","/documents/"+id,null,bib,null).status);
    }
}
