package cl.bec;

import java.time.*;
import java.util.*;
import java.io.ByteArrayInputStream;
import javax.imageio.ImageIO;
import static cl.bec.Problem.require;

public final class ClientsService extends Node {
    public ClientsService(Config c,Clock clock) throws Exception { super(c,clock,true); }
    private Map<String,Object> privateData(Map<String,Object> row) { return Json.object(Crypto.decrypt(secrets.get("dataKey"),Json.str(row,"cipher"))); }
    private void save(Store.Tx tx,Map<String,Object> row,Map<String,Object> data) {
        row.put("cipher",Crypto.encrypt(secrets.get("dataKey"),Json.write(data)));tx.put("READER",row);
    }
    private String photo(Map<String,Object> b) {
        String photo=Validation.text(b,"photo",40,180000);
        try {
            byte[] bytes=Base64.getDecoder().decode(photo);require(bytes.length<=128000,400,"PHOTO_SIZE","Foto excede 128 KiB.");
            var img=ImageIO.read(new ByteArrayInputStream(bytes));
            require(img!=null&&img.getWidth()<=1024&&img.getHeight()<=1024,400,"PHOTO_FORMAT","Use PNG/JPEG hasta 1024 × 1024.");
            return photo;
        } catch(Problem e) { throw e; } catch(Exception e) { throw new Problem(400,"PHOTO_FORMAT","Fotografía PNG/JPEG en base64 inválida."); }
    }
    private Map<String,Object> dto(Map<String,Object> row,Principal user) {
        var p=privateData(row);
        var result=Json.map("id",row.get("id"),"state",row.get("state"),"names",p.get("names"),"surnames",p.get("surnames"),"photo",p.get("photo"));
        if(!user.role().equals("LIBRARIAN")) for(String field:List.of("rut","address","email","telephone","documentsChecked")) result.put(field,p.get(field));
        return result;
    }
    @Override protected Reply handle(Request r) {
        if(r.path.startsWith("/activate/")&&r.method.equals("POST")) {
            r.callers("auth");String id=r.id("/activate/");
            store.tx(tx->{var row=tx.require("READER",id);row.put("state","ACTIVE");tx.put("READER",row);return null;});
            return Reply.ok(Json.map("active",true));
        }
        if(r.path.startsWith("/eligibility/")&&r.method.equals("GET")) {
            r.callers("orders");String id=r.id("/eligibility/");r.user.owner(id);
            var row=store.read(tx->tx.require("READER",id));return Reply.ok(Json.map("id",id,"active",Json.str(row,"state").equals("ACTIVE")));
        }
        if(r.path.startsWith("/contact/")&&r.method.equals("GET")) {
            r.callers("notifications");var row=store.read(tx->tx.require("READER",r.id("/contact/")));var p=privateData(row);
            return Reply.ok(Json.map("email",p.get("email"),"names",p.get("names")));
        }
        if(r.path.equals("/verify")&&r.method.equals("POST")) {
            r.callers("orders");r.user.roles("LIBRARIAN");var b=r.json();Validation.fields(b,"readerId","rut","fingerprint");
            String id=Validation.text(b,"readerId",1,100),rut=Validation.rut(b),fingerprint=Validation.text(b,"fingerprint",32,2048);
            var row=store.read(tx->tx.require("READER",id));var p=privateData(row);
            require(Json.str(row,"state").equals("ACTIVE")&&Crypto.equal(rut,Json.str(p,"rut"))&&
                Crypto.equal(Crypto.hmac(secrets.get("biometricKey"),fingerprint),Json.str(p,"fingerprintHash")),403,"IDENTITY_MISMATCH","RUN o evidencia biométrica no coincide.");
            return Reply.ok(Json.map("verified",true,"readerId",id,"adapter","DETERMINISTIC_TEST_NOT_PHYSICAL_SDK"));
        }
        r.callers("gateway","graphql");
        if(r.path.equals("/readers")&&r.method.equals("POST")) {
            r.user.roles("ADMIN");var b=r.json();
            Validation.fields(b,"rut","names","surnames","address","email","telephone","photo","fingerprint","password","documentsChecked");
            String rut=Validation.rut(b),email=Validation.email(b),fingerprint=Validation.text(b,"fingerprint",32,2048);
            try { require(Base64.getDecoder().decode(fingerprint).length>=24,400,"BIOMETRIC_FORMAT","Muestra de prueba base64 insuficiente."); }
            catch(IllegalArgumentException e) { throw new Problem(400,"BIOMETRIC_FORMAT","Muestra de prueba en base64 requerida."); }
            String password=Validation.text(b,"password",12,128);
            require(Boolean.TRUE.equals(b.get("documentsChecked")),400,"DOCUMENTS_REQUIRED","El administrativo debe comprobar los documentos.");
            var p=Json.map("rut",rut,"names",Validation.text(b,"names",2,80),"surnames",Validation.text(b,"surnames",2,100),
                "address",Validation.text(b,"address",5,200),"email",email,"telephone",Validation.text(b,"telephone",8,20),"photo",photo(b),
                "fingerprintHash",Crypto.hmac(secrets.get("biometricKey"),fingerprint),"documentsChecked",true,"pendingPasswordHash",Crypto.password(password));
            String id="r-"+UUID.randomUUID();String rutHash=Crypto.hmac(secrets.get("dataKey"),rut);
            var available=rpc("auth","POST","/accounts/check-email",Json.map("email",email),r.user,r.correlation);
            require(Boolean.TRUE.equals(available.get("available")),409,"EMAIL_EXISTS","Correo ya inscrito.");
            String emailHash=Crypto.hmac(secrets.get("dataKey"),email);
            var row=store.tx(tx->{
                require(tx.get("RUT",rutHash)==null,409,"RUT_EXISTS","RUN ya inscrito.");
                require(tx.get("EMAIL",emailHash)==null,409,"EMAIL_EXISTS","Correo ya inscrito.");
                var result=Json.map("id",id,"ownerId",id,"state","INACTIVE","accountPending",true);
                save(tx,result,p);tx.put("RUT",Json.map("id",rutHash,"ownerId",id));tx.put("EMAIL",Json.map("id",emailHash,"ownerId",id));return result;
            });
            // La cola persistente accountPending recupera fallas sin perder la inscripción.
            try { provision(row); } catch(Problem ignored) {}
            return Reply.created(Json.map("id",id,"state","INACTIVE","message","Ficha registrada; debe validar el correo antes de ingresar."));
        }
        if(r.path.equals("/readers")&&r.method.equals("GET")) {
            r.user.roles("ADMIN");String q=r.query.getOrDefault("q","").toLowerCase(Locale.ROOT);
            require(q.length()<=100,400,"VALIDATION","Búsqueda demasiado extensa.");
            var rows=store.read(tx->tx.list("READER")).stream().map(x->dto(x,r.user))
                .filter(x->(Json.str(x,"names")+" "+Json.str(x,"surnames")+" "+Json.str(x,"rut")).toLowerCase(Locale.ROOT).contains(q)).toList();
            return Reply.ok(Json.map("items",page(rows,r),"total",rows.size(),"page",r.page(),"size",r.pageSize()));
        }
        if(r.path.matches("/readers/[A-Za-z0-9_-]{1,100}/activation")&&r.method.equals("POST")) {
            r.user.roles("ADMIN");Validation.fields(r.json());String id=r.path.split("/")[2];
            var row=store.read(tx->tx.require("READER",id));
            require(Json.str(row,"state").equals("INACTIVE"),409,"ALREADY_ACTIVE","El lector ya está activo.");
            require(!Boolean.TRUE.equals(row.get("accountPending")),409,"ACCOUNT_PENDING","La inscripción aún se está recuperando; reintente.");
            return Reply.ok(rpc("auth","POST","/accounts/"+id+"/activation",Json.map(),r.user,r.correlation));
        }
        if(r.path.startsWith("/readers/")) {
            String id=r.id("/readers/");
            if(r.method.equals("GET")) {
                r.user.roles("ADMIN","LIBRARIAN","READER");r.user.owner(id);
                return Reply.ok(dto(store.read(tx->tx.require("READER",id)),r.user));
            }
            if(r.method.equals("PUT")) {
                r.user.roles("ADMIN");var b=r.json();Validation.fields(b,"address","telephone","photo");
                var row=store.tx(tx->{
                    var x=tx.require("READER",id);var p=privateData(x);
                    p.put("address",Validation.text(b,"address",5,200));p.put("telephone",Validation.text(b,"telephone",8,20));p.put("photo",photo(b));save(tx,x,p);return x;
                });return Reply.ok(dto(row,r.user));
            }
        }
        throw new Problem(404,"NOT_FOUND","Operación de clientes no publicada.");
    }
    private void provision(Map<String,Object> row) {
        var p=privateData(row);
        rpc("auth","POST","/accounts",Json.map("id",row.get("id"),"email",p.get("email"),"passwordHash",p.get("pendingPasswordHash")),Principal.ANONYMOUS,UUID.randomUUID().toString());
        store.tx(tx->{var latest=tx.require("READER",Json.str(row,"id"));var data=privateData(latest);data.remove("pendingPasswordHash");latest.put("accountPending",false);save(tx,latest,data);return null;});
    }
    @Override protected void tick() {
        for(var row:store.read(tx->tx.list("READER"))) if(Boolean.TRUE.equals(row.get("accountPending"))) provision(row);
    }
}
