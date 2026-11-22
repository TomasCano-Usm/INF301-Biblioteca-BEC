package cl.bec;

import java.time.*;
import java.util.Map;

public final class Policies {
    public static final ZoneId ZONE=ZoneId.of("America/Santiago");
    private Policies() {}
    public static Instant due(Map<String,Object> document,String mode,Instant issued) {
        var local=issued.atZone(ZONE);
        if(mode.equals("HOME")) return local.plusDays(Json.integer(document,"homeDays",7)).toInstant();
        Instant byHours=issued.plus(Duration.ofHours(Json.integer(document,"roomHours",3)));
        Instant end=local.toLocalDate().atTime(LocalTime.MAX).atZone(ZONE).toInstant();
        return byHours.isBefore(end)?byHours:end;
    }
    public static Instant ready(Instant returned) { return returned.plus(Duration.ofMinutes(30)); }
    /** Regla propuesta (no cuantificada por el enunciado): 1 día/fracción; tope 30. */
    public static Instant sanction(Instant due,Instant returned) {
        if(!returned.isAfter(due)) return returned;
        long days=Math.max(1,Math.min(30,(Duration.between(due,returned).getSeconds()+86399)/86400));
        return returned.plus(Duration.ofDays(days));
    }
}
