package cl.bec;

import java.time.*;
import java.util.*;
import static cl.bec.Problem.require;

public final class AuthService extends Node {
    private final String dummy=Crypto.password(Crypto.random());
    public AuthService(Config c,Clock clock) throws Exception {
        super(c,clock,true);
        if(secrets.all().get("initialAccounts") instanceof List<?> initial) {
            for(Object value:initial) {
                @SuppressWarnings("unchecked") var account=(Map<String,Object>)value;
                store.tx(tx->{
                    String id=Json.str(account,"id");
                    if(tx.get("ACCOUNT",id)==null) {
                        var a=Json.map("id",id,"role",account.get("role"),"state","ACTIVE",
                            "emailHash",Crypto.hmac(secrets.get("dataKey"),Json.str(account,"email")),
                            "emailCipher",Crypto.encrypt(secrets.get("dataKey"),Json.str(account,"email")),
                            "passwordHash",account.get("passwordHash"));
                        tx.put("ACCOUNT",a);
                    } return null;
                });
            }
        }
    }
    @Override protected Reply handle(Request r) {
        if(r.path.equals("/accounts")&&r.method.equals("POST")) {
            r.callers("clients"); var b=r.json(); Validation.fields(b,"id","email","passwordHash");
            String id=Validation.text(b,"id",1,100),email=Validation.email(b),hash=Validation.text(b,"passwordHash",50,200);
            require(hash.startsWith("pbkdf2-sha256$600000$"),400,"VALIDATION","Hash adaptativo no admitido.");
            var result=store.tx(tx->{
                var old=tx.get("ACCOUNT",id); if(old!=null) return Json.map("id",id,"state",old.get("state"));
                String emailHash=Crypto.hmac(secrets.get("dataKey"),email);
                require(tx.list("ACCOUNT").stream().noneMatch(a->emailHash.equals(a.get("emailHash"))),409,"EMAIL_EXISTS","Correo ya inscrito.");
                String token=Crypto.random();
                tx.put("ACCOUNT",Json.map("id",id,"role","READER","state","INACTIVE","emailHash",emailHash,
                    "emailCipher",Crypto.encrypt(secrets.get("dataKey"),email),"passwordHash",hash,
                    "activationHash",Crypto.sha(token),"activationCipher",Crypto.encrypt(secrets.get("dataKey"),token),
                    "activationExpiresAt",now().plus(Duration.ofHours(24)).toString(),"activationVersion",1,"activationSent",false));
                return Json.map("id",id,"state","INACTIVE");
            });
            return Reply.created(result);
        }
        if(r.path.equals("/accounts/check-email")&&r.method.equals("POST")) {
            r.callers("clients");r.user.roles("ADMIN");var b=r.json();Validation.fields(b,"email");
            String hash=Crypto.hmac(secrets.get("dataKey"),Validation.email(b));
            boolean available=store.read(tx->tx.list("ACCOUNT").stream().noneMatch(a->hash.equals(a.get("emailHash"))));
            return Reply.ok(Json.map("available",available));
        }
        if(r.path.matches("/accounts/[A-Za-z0-9_-]{1,100}/activation")&&r.method.equals("POST")) {
            r.callers("clients");r.user.roles("ADMIN");Validation.fields(r.json());
            String id=r.path.split("/")[2];
            store.tx(tx->{
                var account=tx.require("ACCOUNT",id);
                require(Json.str(account,"state").equals("INACTIVE"),409,"ALREADY_ACTIVE","La cuenta ya fue activada.");
                String token=Crypto.random();
                account.put("activationHash",Crypto.sha(token));account.put("activationCipher",Crypto.encrypt(secrets.get("dataKey"),token));
                account.put("activationVersion",Json.integer(account,"activationVersion",1)+1);
                account.put("activationExpiresAt",now().plus(Duration.ofHours(24)).toString());account.put("activationSent",false);
                tx.put("ACCOUNT",account);return null;
            });
            return Reply.ok(Json.map("queued",true,"expiresInHours",24,"previousLinkRevoked",true));
        }
        r.callers("gateway");
        if(r.path.equals("/login")&&r.method.equals("POST")) {
            var b=r.json();Validation.fields(b,"email","password");
            String email=Validation.email(b),password=Validation.text(b,"password",1,128);
            String emailHash=Crypto.hmac(secrets.get("dataKey"),email);
            var account=store.read(tx->tx.list("ACCOUNT").stream().filter(a->emailHash.equals(a.get("emailHash"))).findFirst().orElse(null));
            boolean valid=Crypto.verifyPassword(password,account==null?dummy:Json.str(account,"passwordHash"));
            require(valid&&account!=null&&Json.str(account,"state").equals("ACTIVE"),401,"INVALID_CREDENTIALS","Credenciales inválidas o cuenta no activada.");
            String token=Crypto.random(),expires=now().plus(Duration.ofMinutes(20)).toString();
            store.tx(tx->{tx.put("SESSION",Json.map("id",Crypto.sha(token),"ownerId",account.get("id"),"role",account.get("role"),"state","ACTIVE","expiresAt",expires));return null;});
            return Reply.ok(Json.map("token",token,"expiresAt",expires,"id",account.get("id"),"role",account.get("role")));
        }
        if(r.path.equals("/introspect")&&r.method.equals("POST")) {
            var b=r.json();Validation.fields(b,"token");String token=Json.str(b,"token");
            require(token.matches("[A-Za-z0-9_-]{43}"),401,"INVALID_TOKEN","Token de sesión inválido.");
            var s=store.read(tx->tx.get("SESSION",Crypto.sha(token)));
            require(s!=null&&Json.str(s,"state").equals("ACTIVE")&&Instant.parse(Json.str(s,"expiresAt")).isAfter(now()),401,"SESSION_EXPIRED","Sesión inválida, revocada o vencida.");
            return Reply.ok(Json.map("id",s.get("ownerId"),"role",s.get("role"),"expiresAt",s.get("expiresAt")));
        }
        if(r.path.equals("/logout")&&r.method.equals("POST")) {
            r.user.roles("READER","LIBRARIAN","ADMIN");var b=r.json();Validation.fields(b,"token");
            String hash=Crypto.sha(Validation.text(b,"token",43,43));
            store.tx(tx->{var s=tx.get("SESSION",hash);if(s!=null&&Json.str(s,"ownerId").equals(r.user.id())) {s.put("state","REVOKED");tx.put("SESSION",s);}return null;});
            return Reply.ok(Json.map("revoked",true));
        }
        if(r.path.equals("/me")&&r.method.equals("GET")) {
            r.user.roles("READER","LIBRARIAN","ADMIN");return Reply.ok(Json.map("id",r.user.id(),"role",r.user.role()));
        }
        if(r.path.equals("/activate")&&r.method.equals("POST")) {
            var b=r.json();Validation.fields(b,"token");String hash=Crypto.sha(Validation.text(b,"token",43,43));
            store.tx(tx->{
                var account=tx.list("ACCOUNT").stream().filter(a->hash.equals(a.get("activationHash"))).findFirst().orElse(null);
                require(account!=null,400,"INVALID_ACTIVATION","Enlace de activación inválido.");
                require(Json.str(account,"state").equals("INACTIVE"),409,"TOKEN_USED","Este enlace ya fue utilizado.");
                require(Instant.parse(Json.str(account,"activationExpiresAt")).isAfter(now()),410,"ACTIVATION_EXPIRED","El enlace venció; solicite reenvío al administrativo.");
                rpc("clients","POST","/activate/"+account.get("id"),Json.map(),Principal.ANONYMOUS,r.correlation);
                account.put("state","ACTIVE");account.remove("activationCipher");tx.put("ACCOUNT",account);return null;
            });
            return Reply.ok(Json.map("activated",true));
        }
        throw new Problem(404,"NOT_FOUND","Operación de autenticación no publicada.");
    }
    @Override protected void tick() {
        var accounts=store.read(tx->tx.list("ACCOUNT"));
        for(var a:accounts) if(Json.str(a,"state").equals("INACTIVE")&&!Boolean.TRUE.equals(a.get("activationSent"))) {
            rpc("notifications","POST","/events",Json.map("id","activation-"+a.get("id")+"-v"+Json.integer(a,"activationVersion",1),"kind","ACTIVATION","readerId",a.get("id"),
                "token",Crypto.decrypt(secrets.get("dataKey"),Json.str(a,"activationCipher"))),Principal.ANONYMOUS,UUID.randomUUID().toString());
            store.tx(tx->{var latest=tx.require("ACCOUNT",Json.str(a,"id"));
                if(Json.integer(latest,"activationVersion",1)==Json.integer(a,"activationVersion",1)) { latest.put("activationSent",true);tx.put("ACCOUNT",latest); }return null;});
        }
        store.tx(tx->{
            for(var s:tx.list("SESSION")) if(Instant.parse(Json.str(s,"expiresAt")).plus(Duration.ofDays(1)).isBefore(now())) tx.delete("SESSION",Json.str(s,"id"));
            return null;
        });
    }
}
