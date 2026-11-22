package cl.bec;

import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static cl.bec.Problem.require;

public final class ApiGateway extends Node {
    private final Map<String,long[]> rates=new ConcurrentHashMap<>();
    public ApiGateway(Config c,Clock clock) throws Exception { super(c,clock,false); }
    private void rate(Request r) {
        String ip=r.exchange.getRemoteAddress().getAddress().getHostAddress();
        String key=ip+(r.path.equals("/api/auth/login")?":login":":api");
        long minute=System.currentTimeMillis()/60000;
        long[] counter=rates.compute(key,(k,v)->v==null||v[0]!=minute?new long[]{minute,1}:new long[]{minute,v[1]+1});
        int limit=r.path.equals("/api/auth/login")?Json.integer(config.bootstrap,"loginRate",10):Json.integer(config.bootstrap,"apiRate",6000);
        require(counter[1]<=limit,429,"RATE_LIMIT","Límite de solicitudes excedido; reintente el próximo minuto.");
    }
    @Override protected Reply handle(Request r) throws Exception {
        rate(r);
        if(r.path.equals("/api/health")&&r.method.equals("GET")) return Reply.ok(Json.map("status","UP"));
        if(r.method.equals("GET") && Set.of("/","/index.html","/app.js","/style.css","/help.html").contains(r.path)) {
            String file=r.path.equals("/")?"index.html":r.path.substring(1);
            Path root=Path.of(Json.str(config.bootstrap,"webRoot"));
            String type=file.endsWith(".js")?"text/javascript; charset=utf-8":file.endsWith(".css")?"text/css; charset=utf-8":"text/html; charset=utf-8";
            return Reply.ok(new StaticFile(Files.readAllBytes(root.resolve(file)),type));
        }
        var route=Routes.ALL.stream().filter(x->x.matches(r.method,r.path)).findFirst();
        if(route.isEmpty()) {
            boolean known=Routes.ALL.stream().anyMatch(x->x.matches(x.method(),r.path));
            throw new Problem(known?405:404,known?"METHOD_NOT_ALLOWED":"NOT_FOUND","Operación no publicada por el gateway.");
        }
        var def=route.get(); Principal user=Principal.ANONYMOUS;
        boolean authenticated=!r.header("Authorization").isEmpty();
        if(!def.roles().equals("PUBLIC")||authenticated) {
            require(r.header("Authorization").startsWith("Bearer "),401,"SESSION_REQUIRED","Se requiere una sesión válida.");
            String token=r.header("Authorization").substring(7);
            require(token.matches("[A-Za-z0-9_-]{43}"),401,"INVALID_TOKEN","Token de sesión inválido.");
            var identity=rpc("auth","POST","/introspect",Json.map("token",token),Principal.ANONYMOUS,r.correlation);
            user=new Principal(Json.str(identity,"id"),Json.str(identity,"role"));
            if(!def.roles().equals("PUBLIC")) user.roles(def.roles().split(","));
        }
        Object body=null;
        if(!r.body.isEmpty()) body=r.json();
        if(def.id().equals("S02")) body=Json.map("token",r.header("Authorization").substring(7));
        String path=def.destination(r.path);
        if(r.exchange.getRequestURI().getRawQuery()!=null) path+="?"+r.exchange.getRequestURI().getRawQuery();
        // No se copia ningún encabezado de identidad técnica del navegador.
        String idempotency=r.header("Idempotency-Key");
        return call(def.target(),r.method,path,body,user,r.correlation,idempotency.isEmpty()?null:idempotency);
    }
}
