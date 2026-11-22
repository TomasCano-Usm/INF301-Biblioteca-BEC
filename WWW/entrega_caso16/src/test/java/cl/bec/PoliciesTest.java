package cl.bec;

import org.junit.jupiter.api.Test;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

class PoliciesTest {
    @Test void T_UNIT_01_bufferExacto() {
        Instant returned=Instant.parse("2026-11-18T12:00:00Z"),ready=Policies.ready(returned);
        assertTrue(ready.isAfter(returned.plusSeconds(1799)));
        assertEquals(returned.plusSeconds(1800),ready);
    }
    @Test void T_UNIT_02_salaMismoDiaYPlazosDistintos() {
        Instant issued=ZonedDateTime.of(2026,11,18,23,0,0,0,Policies.ZONE).toInstant();
        var book=Json.map("homeDays",3,"roomHours",4);
        assertEquals(issued.atZone(Policies.ZONE).toLocalDate(),Policies.due(book,"ROOM",issued).atZone(Policies.ZONE).toLocalDate());
        assertEquals(23,Policies.due(book,"ROOM",issued).atZone(Policies.ZONE).getHour());
        assertEquals(issued.atZone(Policies.ZONE).plusDays(3).toInstant(),Policies.due(book,"HOME",issued));
    }
    @Test void T_UNIT_03_sancionFronteraYTope() {
        Instant due=Instant.parse("2026-11-18T12:00:00Z");
        assertEquals(due,Policies.sanction(due,due));
        assertEquals(due.plusSeconds(1).plus(Duration.ofDays(1)),Policies.sanction(due,due.plusSeconds(1)));
        assertEquals(due.plus(Duration.ofDays(130)),Policies.sanction(due,due.plus(Duration.ofDays(100))));
    }
    @Test void T_UNIT_04_clavesYSobres() {
        String a=Crypto.password("Password-ficticia-larga"),b=Crypto.password("Password-ficticia-larga");
        assertNotEquals(a,b);assertTrue(Crypto.verifyPassword("Password-ficticia-larga",a));assertFalse(Crypto.verifyPassword("incorrecta",a));
        String key=java.util.Base64.getEncoder().encodeToString(new byte[32]),cipher=Crypto.encrypt(key,"RUN-ficticio");
        assertNotEquals("RUN-ficticio",cipher);assertEquals("RUN-ficticio",Crypto.decrypt(key,cipher));
        assertThrows(IllegalStateException.class,()->Crypto.decrypt(key,cipher.substring(0,cipher.length()-4)+"AAAA"));
    }
    @Test void T_UNIT_05_salaUltimoMinutoNoVenceAntesDeEntrega() {
        Instant issued=ZonedDateTime.of(2026,11,18,23,59,50,0,Policies.ZONE).toInstant();
        Instant due=Policies.due(Json.map("roomHours",3),"ROOM",issued);
        assertTrue(due.isAfter(issued));assertEquals(issued.atZone(Policies.ZONE).toLocalDate(),due.atZone(Policies.ZONE).toLocalDate());
    }
}
