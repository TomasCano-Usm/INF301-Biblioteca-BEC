package cl.bec;

import java.nio.file.*;
import java.security.KeyStore;
import javax.net.ssl.*;
import java.util.*;

public final class Config {
    public final Path runtime;
    public final String name;
    public final Map<String,Object> bootstrap;
    public final SSLContext tls;
    public Config(Path runtime,String name) throws Exception {
        this.runtime=runtime.toAbsolutePath(); this.name=name;
        bootstrap=Json.object(Files.readString(this.runtime.resolve(name).resolve("bootstrap.json")));
        char[] pass=Json.str(bootstrap,"tlsPassword").toCharArray();
        KeyStore own=KeyStore.getInstance("PKCS12");
        try(var in=Files.newInputStream(this.runtime.resolve(name).resolve("server.p12"))) { own.load(in,pass); }
        KeyManagerFactory km=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); km.init(own,pass);
        KeyStore trust=KeyStore.getInstance("PKCS12");
        try(var in=Files.newInputStream(this.runtime.resolve(name).resolve("trust.p12"))) { trust.load(in,pass); }
        TrustManagerFactory tm=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); tm.init(trust);
        tls=SSLContext.getInstance("TLS"); tls.init(km.getKeyManagers(),tm.getTrustManagers(),null);
        // OJDBC TCPS usa el truststore de ESTA JVM; cada contenedor monta solo el suyo.
        System.setProperty("javax.net.ssl.trustStore",this.runtime.resolve(name).resolve("trust.p12").toString());
        System.setProperty("javax.net.ssl.trustStorePassword",new String(pass));
        System.setProperty("javax.net.ssl.trustStoreType","PKCS12");
    }
    public int port() { return Json.integer(bootstrap,"port",8443); }
    public String address() { return Json.str(bootstrap,"bind"); }
    public String target(String name) {
        @SuppressWarnings("unchecked") var targets=(Map<String,Object>)bootstrap.get("targets");
        String value=targets==null ? "" : Json.str(targets,name);
        Problem.require(!value.isEmpty(),503,"CONFIGURATION","Destino interno no configurado.");
        return value;
    }
}
