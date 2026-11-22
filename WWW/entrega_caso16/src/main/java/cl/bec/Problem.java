package cl.bec;

public final class Problem extends RuntimeException {
    public final int status;
    public final String code;
    public Problem(int status, String code, String message) { super(message); this.status=status; this.code=code; }
    public static void require(boolean condition,int status,String code,String message) {
        if (!condition) throw new Problem(status,code,message);
    }
}
