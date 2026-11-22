package cl.bec;

import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import static cl.bec.Problem.require;

public final class SecretManager extends Node {
    public SecretManager(Config c,Clock clock) throws Exception { super(c,clock,false); }
    @Override protected Reply handle(Request r) throws Exception {
        require(r.method.equals("GET")&&r.path.matches("/v1/secrets/[a-z]{3,20}"),404,"NOT_FOUND","Recurso no publicado.");
        String consumer=r.path.substring("/v1/secrets/".length());
        @SuppressWarnings("unchecked") var acl=(Map<String,Object>)config.bootstrap.get("acl");
        String token=r.header("Authorization").replaceFirst("^Bearer ","");
        require(Crypto.equal(Crypto.sha(token),Json.str(acl,consumer)),403,"SECRET_SCOPE","El token no puede leer ese conjunto de secretos.");
        Path file=config.runtime.resolve("secrets").resolve("master").resolve(consumer+".enc");
        require(Files.exists(file),404,"NOT_FOUND","Conjunto no encontrado.");
        return Reply.ok(Json.object(Crypto.decrypt(Json.str(config.bootstrap,"masterKey"),Files.readString(file))));
    }
}
