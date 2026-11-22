package cl.bec;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class Json {
    public static final ObjectMapper MAPPER = new ObjectMapper()
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private Json() {}
    public static String write(Object value) {
        try { return MAPPER.writeValueAsString(value); }
        catch (Exception e) { throw new IllegalStateException("No se pudo serializar"); }
    }
    public static byte[] bytes(Object value) { return write(value).getBytes(StandardCharsets.UTF_8); }
    public static Map<String,Object> object(String value) {
        try { return MAPPER.readValue(value, new TypeReference<LinkedHashMap<String,Object>>() {}); }
        catch (Exception e) { throw new Problem(400, "INVALID_JSON", "Se requiere un objeto JSON válido."); }
    }
    public static Map<String,Object> map(Object... pairs) {
        var result = new LinkedHashMap<String,Object>();
        for (int i=0; i<pairs.length; i+=2) result.put((String)pairs[i], pairs[i+1]);
        return result;
    }
    public static String str(Map<String,Object> map, String key) { return Objects.toString(map.get(key), ""); }
    @SuppressWarnings("unchecked")
    public static List<Map<String,Object>> rows(Object value) { return (List<Map<String,Object>>) value; }
    public static int integer(Map<String,Object> map, String key, int fallback) {
        Object value=map.get(key);
        try { return value==null ? fallback : Integer.parseInt(value.toString()); }
        catch (Exception e) { throw new Problem(400,"INVALID_NUMBER","Número inválido: "+key); }
    }
}
