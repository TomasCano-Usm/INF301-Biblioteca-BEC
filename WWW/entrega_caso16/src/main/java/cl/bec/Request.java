package cl.bec;

import com.sun.net.httpserver.HttpExchange;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static cl.bec.Problem.require;

public final class Request {
    public final HttpExchange exchange;
    public final String method,path,rawPath,body,correlation;
    public final Map<String,String> query=new HashMap<>();
    public Principal user=Principal.ANONYMOUS;
    public String caller="";
    public Request(HttpExchange exchange) throws Exception {
        this.exchange=exchange; method=exchange.getRequestMethod(); path=exchange.getRequestURI().getPath();
        rawPath=exchange.getRequestURI().toASCIIString();
        require(rawPath.length()<=2048,414,"URI_TOO_LONG","Ruta demasiado extensa.");
        byte[] bytes=exchange.getRequestBody().readNBytes(262145);
        require(bytes.length<=262144,413,"PAYLOAD_TOO_LARGE","El cuerpo excede 256 KiB.");
        body=new String(bytes,StandardCharsets.UTF_8);
        String q=exchange.getRequestURI().getRawQuery();
        if(q!=null) for(String pair:q.split("&")) {
            String[] p=pair.split("=",2);
            String key=URLDecoder.decode(p[0],StandardCharsets.UTF_8);
            require(!query.containsKey(key),400,"DUPLICATE_PARAMETER","Parámetro repetido.");
            query.put(key,p.length==2?URLDecoder.decode(p[1],StandardCharsets.UTF_8):"");
        }
        String candidate=header("X-Correlation-ID");
        correlation=candidate.matches("[A-Za-z0-9-]{8,64}")?candidate:UUID.randomUUID().toString();
    }
    public Map<String,Object> json() {
        require(header("Content-Type").toLowerCase(Locale.ROOT).startsWith("application/json"),415,"CONTENT_TYPE","Use application/json.");
        return Json.object(body);
    }
    public String header(String name) { return Objects.toString(exchange.getRequestHeaders().getFirst(name),""); }
    public void callers(String... allowed) { require(Set.of(allowed).contains(caller),403,"SERVICE_FORBIDDEN","Consumidor técnico no autorizado para esta operación."); }
    public String id(String prefix) {
        String id=path.substring(prefix.length());
        require(id.matches("[A-Za-z0-9_-]{1,100}"),400,"INVALID_ID","Identificador inválido."); return id;
    }
    public int pageSize() {
        try { int n=Integer.parseInt(query.getOrDefault("size","10")); require(n>=1&&n<=20,400,"PAGINATION","size debe estar entre 1 y 20."); return n; }
        catch(NumberFormatException e) { throw new Problem(400,"PAGINATION","size debe ser entero."); }
    }
    public int page() {
        try { int n=Integer.parseInt(query.getOrDefault("page","0")); require(n>=0&&n<=1000,400,"PAGINATION","page fuera de rango."); return n; }
        catch(NumberFormatException e) { throw new Problem(400,"PAGINATION","page debe ser entero."); }
    }
    public String idempotency() {
        String value=header("Idempotency-Key");
        require(value.matches("[A-Za-z0-9_-]{8,80}"),400,"IDEMPOTENCY_REQUIRED","Se requiere Idempotency-Key de 8 a 80 caracteres."); return value;
    }
}
