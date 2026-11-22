package cl.bec;

import com.sun.net.httpserver.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public abstract class Node implements AutoCloseable {
    public final Config config;
    public final SecretProvider secrets;
    public final TechnicalIdentity identity;
    public Store store;
    protected final Clock clock;
    private final HttpsServer server;
    private final ExecutorService executor=Executors.newVirtualThreadPerTaskExecutor();
    private final ScheduledExecutorService jobs=Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().daemon().factory());
    private final Semaphore slots=new Semaphore(64);
    private final AtomicBoolean runningJob=new AtomicBoolean();
    private final HttpClient client;
    public Node(Config config,Clock clock,boolean persistence) throws Exception {
        this.config=config; this.clock=clock; secrets=new SecretProvider(config); identity=new TechnicalIdentity(config,secrets);
        if(persistence) store=new Store(secrets);
        client=HttpClient.newBuilder().sslContext(config.tls).connectTimeout(Duration.ofSeconds(2)).build();
        server=HttpsServer.create(new InetSocketAddress(config.address(),config.port()),64);
        server.setHttpsConfigurator(new HttpsConfigurator(config.tls) {
            @Override public void configure(HttpsParameters params) {
                var p=config.tls.getDefaultSSLParameters(); p.setProtocols(new String[]{"TLSv1.3","TLSv1.2"}); params.setSSLParameters(p);
            }
        });
        server.setExecutor(executor); server.createContext("/",this::serve);
    }
    public void start() {
        server.start();
        if(!config.name.equals("secrets")&&!Boolean.TRUE.equals(config.bootstrap.get("manualJobs")))
            jobs.scheduleWithFixedDelay(this::safeTick,1,1,TimeUnit.SECONDS);
    }
    public void safeTick() {
        if(!runningJob.compareAndSet(false,true)) return;
        try { tick(); } catch(Exception e) { System.out.println(Json.write(Json.map("service",config.name,"event","job_retry","type",e.getClass().getSimpleName()))); }
        finally { runningJob.set(false); }
    }
    protected void tick() {}
    protected abstract Reply handle(Request r) throws Exception;
    protected boolean verifiesIdentity() { return !Set.of("gateway","secrets").contains(config.name); }
    private void serve(HttpExchange exchange) {
        long begin=System.nanoTime(); int status=500; String correlation=UUID.randomUUID().toString(),method=exchange.getRequestMethod();
        boolean acquired=slots.tryAcquire();
        try {
            if(!acquired) throw new Problem(429,"CONCURRENCY_LIMIT","Demasiadas solicitudes simultáneas.");
            Request r=new Request(exchange); correlation=r.correlation;
            if(r.path.equals("/health") && r.method.equals("GET")) { send(exchange,200,Json.map("status","UP"),correlation);status=200; return; }
            if(verifiesIdentity()) identity.verify(r);
            Reply reply=handle(r); status=reply.status(); send(exchange,status,reply.body(),correlation);
        } catch(Problem e) {
            status=e.status;
            try { send(exchange,status,Json.map("error",Json.map("code",e.code,"message",e.getMessage(),"correlationId",correlation)),correlation); } catch(Exception ignored) {}
        } catch(Exception e) {
            status=500;
            System.err.println(Json.write(Json.map("service",config.name,"event","internal_error","type",e.getClass().getSimpleName(),"correlationId",correlation)));
            try { send(exchange,500,Json.map("error",Json.map("code","INTERNAL","message","Error interno controlado.","correlationId",correlation)),correlation); } catch(Exception ignored) {}
        } finally {
            if(acquired) slots.release(); exchange.close();
            System.out.println(Json.write(Json.map("service",config.name,"method",method,"status",status,"durationMs",Math.round((System.nanoTime()-begin)/1000000.0),"correlationId",correlation)));
        }
    }
    protected void send(HttpExchange exchange,int status,Object value,String correlation) throws Exception {
        byte[] bytes=value instanceof StaticFile f?f.bytes():Json.bytes(value);
        String contentType=value instanceof StaticFile f?f.type():"application/json; charset=utf-8";
        var h=exchange.getResponseHeaders();
        h.set("Content-Type",contentType);h.set("Cache-Control","no-store");h.set("X-Content-Type-Options","nosniff");
        h.set("Strict-Transport-Security","max-age=31536000");h.set("Referrer-Policy","no-referrer");
        h.set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        h.set("X-Correlation-ID",correlation);
        exchange.sendResponseHeaders(status,bytes.length); exchange.getResponseBody().write(bytes);
    }
    public Reply call(String target,String method,String path,Object data,Principal user,String correlation,String idempotency) {
        String body=data==null?"":Json.write(data);
        try {
            var builder=HttpRequest.newBuilder(URI.create(config.target(target)+path)).timeout(Duration.ofSeconds(4));
            identity.sign(target,method,path,body,user).forEach(builder::header);
            builder.header("Content-Type","application/json").header("X-Correlation-ID",correlation);
            if(idempotency!=null) builder.header("Idempotency-Key",idempotency);
            var response=client.send(builder.method(method,body.isEmpty()?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
            var result=Json.object(response.body());
            if(response.statusCode()>=400) {
                if(response.statusCode()>=500) throw new Problem(502,"DEPENDENCY_UNAVAILABLE","Un subsistema requerido no está disponible.");
                @SuppressWarnings("unchecked") var error=(Map<String,Object>)result.getOrDefault("error",Map.of());
                throw new Problem(response.statusCode(),Json.str(error,"code"),Json.str(error,"message"));
            }
            return new Reply(response.statusCode(),result);
        } catch(Problem e) { throw e; }
        catch(Exception e) { throw new Problem(502,"DEPENDENCY_UNAVAILABLE","Un subsistema requerido no está disponible."); }
    }
    @SuppressWarnings("unchecked")
    public Map<String,Object> rpc(String target,String method,String path,Object body,Principal user,String correlation) {
        return (Map<String,Object>)call(target,method,path,body,user,correlation,null).body();
    }
    public static List<Map<String,Object>> page(List<Map<String,Object>> list,Request r) {
        int from=Math.min(r.page()*r.pageSize(),list.size()); return list.subList(from,Math.min(from+r.pageSize(),list.size()));
    }
    public Instant now() { return clock.instant(); }
    public record StaticFile(byte[] bytes,String type) {}
    @Override public void close() { jobs.shutdownNow();server.stop(0);executor.shutdownNow(); }
}
