package cl.bec;

import java.time.*;
import java.util.*;
import static cl.bec.Problem.require;

public final class Validation {
    private Validation() {}
    public static void fields(Map<String,Object> data,String... fields) {
        var allowed=Set.of(fields);
        require(data.keySet().stream().allMatch(allowed::contains),400,"UNKNOWN_FIELD","El cuerpo contiene campos no admitidos.");
    }
    public static String text(Map<String,Object> d,String name,int min,int max) {
        Object value=d.get(name);
        require(value instanceof String,400,"VALIDATION","Falta un texto válido: "+name);
        String result=((String)value).trim();
        require(result.length()>=min && result.length()<=max && result.chars().noneMatch(c->c<32),400,"VALIDATION","Longitud o formato inválido: "+name);
        return result;
    }
    public static String email(Map<String,Object> d) {
        String e=text(d,"email",5,160).toLowerCase(Locale.ROOT);
        require(e.matches("[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\\.[a-z]{2,}"),400,"VALIDATION","Correo electrónico inválido."); return e;
    }
    public static String rut(Map<String,Object> d) {
        String value=text(d,"rut",9,12).replace(".","").toUpperCase(Locale.ROOT);
        require(value.matches("[0-9]{7,8}-[0-9K]"),400,"INVALID_RUT","RUN inválido.");
        String body=value.split("-")[0]; int sum=0,m=2;
        for(int i=body.length()-1;i>=0;i--){sum+=(body.charAt(i)-'0')*m; m=m==7?2:m+1;}
        int check=11-sum%11; String digit=check==11?"0":check==10?"K":""+check;
        require(value.endsWith("-"+digit),400,"INVALID_RUT","Dígito verificador de RUN inválido."); return value;
    }
    public static String mode(Map<String,Object> d) {
        String v=text(d,"mode",4,4); require(Set.of("HOME","ROOM").contains(v),400,"VALIDATION","Tipo de préstamo: HOME o ROOM."); return v;
    }
    public static int number(Map<String,Object> d,String name,int min,int max) {
        require(d.get(name) instanceof Number,400,"VALIDATION","Número requerido: "+name);
        int n=Json.integer(d,name,-1); require(n>=min && n<=max && ((Number)d.get(name)).doubleValue()==n,400,"VALIDATION","Número fuera de rango: "+name); return n;
    }
    public static List<String> ids(Map<String,Object> d,String name) {
        require(d.get(name) instanceof List<?>,400,"VALIDATION","Lista requerida: "+name);
        List<?> list=(List<?>)d.get(name);
        require(!list.isEmpty() && list.size()<=5 && list.stream().allMatch(x->x instanceof String s && s.matches("[A-Za-z0-9_-]{1,80}")),400,"VALIDATION","Seleccione entre uno y cinco ejemplares.");
        var ids=list.stream().map(Object::toString).toList();
        require(new HashSet<>(ids).size()==ids.size(),400,"DUPLICATE_COPY","Un ejemplar no puede repetirse."); return ids;
    }
    public static LocalDate date(Map<String,Object> d,Clock clock) {
        try {
            var date=LocalDate.parse(text(d,"date",10,10));
            var today=LocalDate.now(clock.withZone(ZoneId.of("America/Santiago")));
            require(!date.isBefore(today) && !date.isAfter(today.plusDays(90)),400,"INVALID_DATE","La reserva debe estar entre hoy y 90 días."); return date;
        } catch(DateTimeException e) { throw new Problem(400,"INVALID_DATE","Fecha ISO requerida: AAAA-MM-DD."); }
    }
}
