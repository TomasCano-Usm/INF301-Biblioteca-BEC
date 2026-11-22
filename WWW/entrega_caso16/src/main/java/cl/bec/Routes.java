package cl.bec;

import java.util.*;
import java.util.regex.*;

public final class Routes {
    public record Route(String id,String method,String external,String target,String internal,String roles,String screen,String purpose) {
        public boolean matches(String verb,String path) { return method.equals(verb)&&Pattern.matches(external.replace("{id}","([A-Za-z0-9_-]{1,100})"),path); }
        public String destination(String path) {
            Matcher m=Pattern.compile(external.replace("{id}","([A-Za-z0-9_-]{1,100})")).matcher(path);
            if(!m.matches()) throw new IllegalArgumentException();
            return external.contains("{id}")?internal.replace("{id}",m.group(1)):internal;
        }
    }
    public static final List<Route> ALL=List.of(
        r("S01","POST","/api/auth/login","auth","/login","PUBLIC","P02","Iniciar sesión"),
        r("S02","POST","/api/auth/logout","auth","/logout","READER,LIBRARIAN,ADMIN","P02","Revocar sesión"),
        r("S03","POST","/api/auth/activate","auth","/activate","PUBLIC","P02","Validar correo de lector"),
        r("S04","GET","/api/auth/me","auth","/me","READER,LIBRARIAN,ADMIN","P02","Identidad de sesión"),
        r("S05","GET","/api/catalog","inventory","/documents","PUBLIC","P01","Buscar catálogo anónimo"),
        r("S06","GET","/api/catalog/{id}","inventory","/documents/{id}","PUBLIC","P01","Detalle y disponibilidad"),
        r("S07","POST","/api/documents","inventory","/documents","LIBRARIAN","P04","Registrar documento"),
        r("S08","PUT","/api/documents/{id}","inventory","/documents/{id}","LIBRARIAN","P04","Actualizar documento"),
        r("S09","DELETE","/api/documents/{id}","inventory","/documents/{id}","LIBRARIAN","P04","Archivar documento"),
        r("S10","POST","/api/documents/{id}/copies","inventory","/documents/{id}/copies","LIBRARIAN","P04","Incorporar ejemplar"),
        r("S11","PUT","/api/copies/{id}","inventory","/copies/{id}","LIBRARIAN","P04","Actualizar ubicación"),
        r("S12","DELETE","/api/copies/{id}","inventory","/copies/{id}","LIBRARIAN","P04","Retirar ejemplar disponible"),
        r("S13","POST","/api/readers","clients","/readers","ADMIN","P05","Inscribir lector y enviar activación"),
        r("S14","GET","/api/readers","clients","/readers","ADMIN","P05","Buscar fichas"),
        r("S15","GET","/api/readers/{id}","clients","/readers/{id}","READER,LIBRARIAN,ADMIN","P05","Consultar ficha según rol"),
        r("S16","PUT","/api/readers/{id}","clients","/readers/{id}","ADMIN","P05","Actualizar contacto y fotografía"),
        r("S17","POST","/api/requests","orders","/requests","READER","P01","Solicitar préstamo"),
        r("S18","GET","/api/requests","orders","/requests","READER,LIBRARIAN","P03,P06","Solicitudes propias o cola"),
        r("S19","DELETE","/api/requests/{id}","orders","/requests/{id}","READER,LIBRARIAN","P03,P06","Cancelar solicitud pendiente"),
        r("S20","POST","/api/requests/{id}/issue","orders","/requests/{id}/issue","LIBRARIAN","P06","Verificar RUN/huella y entregar"),
        r("S21","GET","/api/loans","orders","/loans","READER,LIBRARIAN,ADMIN","P03,P06","Listar préstamos por alcance"),
        r("S22","GET","/api/loans/{id}","orders","/loans/{id}","READER,LIBRARIAN,ADMIN","P03,P06","Detalle de préstamo"),
        r("S23","GET","/api/loans/{id}/receipt","orders","/loans/{id}/receipt","READER,LIBRARIAN","P09","Comprobante de domicilio"),
        r("S24","POST","/api/returns","orders","/returns","LIBRARIAN","P07","Devolver por código"),
        r("S25","POST","/api/reservations","orders","/reservations","READER","P01","Reservar ejemplar/fecha"),
        r("S26","GET","/api/reservations","orders","/reservations","READER,LIBRARIAN","P03,P06","Consultar reservas"),
        r("S27","DELETE","/api/reservations/{id}","orders","/reservations/{id}","READER,LIBRARIAN","P03,P06","Cancelar reserva futura"),
        r("S28","GET","/api/overdue","orders","/overdue","ADMIN","P08","Morosidad sala/domicilio"),
        r("S29","GET","/api/payments/policy","payments","/policy","PUBLIC","P03","Consultar gratuidad"),
        r("S30","GET","/api/payments/assessments/{id}","payments","/assessments/{id}","READER,LIBRARIAN,ADMIN","P03","Consultar evaluación de gratuidad"),
        r("S31","POST","/api/payments/intents","payments","/intents","READER","P03","Rechazar cobro ajeno al caso"),
        r("S32","POST","/api/graphql","graphql","/graphql","READER,LIBRARIAN,ADMIN","P03","Resumen agregado de cuenta"),
        r("S33","GET","/api/exit-check/{id}","inventory","/exit-check/{id}","LIBRARIAN","P07","Simular control de salida"),
        r("S34","GET","/api/lab/mailbox","mail","/mailbox","ADMIN","P10","Bandeja del proveedor de prueba"),
        r("S35","POST","/api/readers/{id}/activation","clients","/readers/{id}/activation","ADMIN","P05","Reenviar activación e invalidar enlace anterior")
    );
    private static Route r(String id,String method,String external,String target,String internal,String roles,String screen,String purpose) {
        return new Route(id,method,external,target,internal,roles,screen,purpose);
    }
    private Routes() {}
}
