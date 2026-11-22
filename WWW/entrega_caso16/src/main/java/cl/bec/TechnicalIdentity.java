package cl.bec;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import static cl.bec.Problem.require;

public final class TechnicalIdentity {
    private final Config config;
    private final SecretProvider secrets;
    private final Map<String,Long> nonces=new ConcurrentHashMap<>();
    public TechnicalIdentity(Config config,SecretProvider secrets) { this.config=config;this.secrets=secrets; }
    public static String canonical(String caller,String audience,String method,String path,String body,String user,String timestamp,String nonce) {
        return String.join("\n",caller,audience,method,path,Crypto.sha(body),user,timestamp,nonce);
    }
    public Map<String,String> sign(String target,String method,String path,String body,Principal user) {
        String key=secrets.edge("outbound",target);
        require(!key.isEmpty(),503,"CONFIGURATION","Canal técnico no configurado.");
        String time=""+Instant.now().getEpochSecond(),nonce=Crypto.random(),context=user.encoded();
        return Map.of("X-Service",config.name,"X-Audience",target,"X-User-Context",context,"X-Timestamp",time,"X-Nonce",nonce,
            "X-Signature",Crypto.hmac(key,canonical(config.name,target,method,path,body,context,time,nonce)));
    }
    public void verify(Request r) {
        String caller=r.header("X-Service"),audience=r.header("X-Audience"),time=r.header("X-Timestamp"),nonce=r.header("X-Nonce"),user=r.header("X-User-Context");
        // Ausencia de identidad se rechaza sin consultar al administrador de secretos.
        require(caller.matches("[a-z]{3,20}") && audience.equals(config.name) && nonce.matches("[A-Za-z0-9_-]{43}"),403,"TECHNICAL_IDENTITY","Falta una identidad técnica válida.");
        long timestamp;
        try { timestamp=Long.parseLong(time); } catch(Exception e) { throw new Problem(403,"TECHNICAL_IDENTITY","Firma técnica inválida."); }
        long now=Instant.now().getEpochSecond();
        require(Math.abs(now-timestamp)<=30,403,"EXPIRED_SIGNATURE","Firma técnica vencida.");
        String key=secrets.edge("inbound",caller);
        require(!key.isEmpty() && Crypto.equal(r.header("X-Signature"),Crypto.hmac(key,canonical(caller,audience,r.method,r.rawPath,r.body,user,time,nonce))),403,"TECHNICAL_IDENTITY","Firma técnica inválida.");
        if(nonces.size()>10000) nonces.entrySet().removeIf(e->e.getValue()<now-60);
        require(nonces.putIfAbsent(caller+":"+nonce,now)==null,403,"REPLAY","Solicitud técnica repetida.");
        r.caller=caller; r.user=Principal.decode(user);
    }
}
