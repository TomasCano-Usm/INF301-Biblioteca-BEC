package cl.bec;

import javax.crypto.*;
import javax.crypto.spec.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

public final class Crypto {
    private static final SecureRandom RANDOM = new SecureRandom();
    private Crypto() {}
    public static String random() { byte[] b=new byte[32]; RANDOM.nextBytes(b); return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    public static String sha(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String hmac(String secret,String value) {
        try {
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(Base64.getDecoder().decode(secret),"HmacSHA256"));
            return Base64.getEncoder().encodeToString(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static boolean equal(String a,String b) {
        return a!=null && b!=null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8));
    }
    public static String password(String value) {
        byte[] salt=new byte[16]; RANDOM.nextBytes(salt);
        return "pbkdf2-sha256$600000$"+Base64.getEncoder().encodeToString(salt)+"$"+derive(value,salt,600000);
    }
    private static String derive(String value,byte[] salt,int rounds) {
        try {
            var spec=new PBEKeySpec(value.toCharArray(),salt,rounds,256);
            byte[] hash=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            spec.clearPassword(); return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static boolean verifyPassword(String value,String encoded) {
        try { String[] p=encoded.split("\\$"); return equal(p[3],derive(value,Base64.getDecoder().decode(p[2]),Integer.parseInt(p[1]))); }
        catch (Exception e) { return false; }
    }
    public static String encrypt(String key,String plain) {
        try {
            byte[] iv=new byte[12]; RANDOM.nextBytes(iv);
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(Base64.getDecoder().decode(key),"AES"),new GCMParameterSpec(128,iv));
            return Base64.getEncoder().encodeToString(iv)+"."+Base64.getEncoder().encodeToString(c.doFinal(plain.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String decrypt(String key,String encoded) {
        try {
            String[] p=encoded.split("\\.");
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE,new SecretKeySpec(Base64.getDecoder().decode(key),"AES"),new GCMParameterSpec(128,Base64.getDecoder().decode(p[0])));
            return new String(c.doFinal(Base64.getDecoder().decode(p[1])),StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalStateException("Dato cifrado ilegible"); }
    }
}
