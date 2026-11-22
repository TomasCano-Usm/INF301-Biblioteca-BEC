package cl.bec;

import java.util.*;
import static cl.bec.Problem.require;

public record Principal(String id,String role) {
    public static final Principal ANONYMOUS=new Principal("","ANONYMOUS");
    public void roles(String... allowed) { require(Set.of(allowed).contains(role),403,"FORBIDDEN","El rol no permite esta operación."); }
    public void owner(String owner) {
        require(!role.equals("READER") || id.equals(owner),403,"RESOURCE_FORBIDDEN","No puede acceder a recursos de otro lector.");
    }
    public String encoded() { return Base64.getUrlEncoder().withoutPadding().encodeToString(Json.bytes(Json.map("id",id,"role",role))); }
    public static Principal decode(String encoded) {
        try {
            var data=Json.object(new String(Base64.getUrlDecoder().decode(encoded),java.nio.charset.StandardCharsets.UTF_8));
            return new Principal(Json.str(data,"id"),Json.str(data,"role"));
        } catch(Exception e) { throw new Problem(403,"TECHNICAL_IDENTITY","Contexto de identidad inválido."); }
    }
}
