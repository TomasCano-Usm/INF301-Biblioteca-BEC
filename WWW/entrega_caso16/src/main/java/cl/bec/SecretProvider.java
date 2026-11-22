package cl.bec;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

/** Bootstrap local por identidad; el consumidor solo puede descargar su propio conjunto. */
public final class SecretProvider {
    private final Config config;
    private final HttpClient client;
    private volatile Map<String,Object> cache;
    private volatile long until;
    public SecretProvider(Config config) {
        this.config=config;
        client=HttpClient.newBuilder().sslContext(config.tls).connectTimeout(Duration.ofSeconds(2)).build();
    }
    public synchronized Map<String,Object> all() {
        if (cache!=null && System.nanoTime()<until) return cache;
        try {
            var request=HttpRequest.newBuilder(URI.create(config.target("secrets")+"/v1/secrets/"+config.name))
                .timeout(Duration.ofSeconds(3)).header("Authorization","Bearer "+Json.str(config.bootstrap,"bootstrapToken")).GET().build();
            var response=client.send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()!=200) throw new IllegalStateException();
            cache=Json.object(response.body());
            until=System.nanoTime()+Duration.ofSeconds(Json.integer(config.bootstrap,"secretCacheSeconds",5)).toNanos();
            return cache;
        } catch(Exception e) { throw new Problem(503,"SECRETS_UNAVAILABLE","Administrador de secretos no disponible; operación cerrada de forma segura."); }
    }
    public String get(String key) { return Json.str(all(),key); }
    @SuppressWarnings("unchecked")
    public String edge(String direction,String service) {
        Object v=all().get(direction);
        return v instanceof Map<?,?> ? Json.str((Map<String,Object>)v,service) : "";
    }
    public void invalidate() { until=0; }
}
