package cl.bec;

public record Reply(int status,Object body) {
    public static Reply ok(Object body) { return new Reply(200,body); }
    public static Reply created(Object body) { return new Reply(201,body); }
}
