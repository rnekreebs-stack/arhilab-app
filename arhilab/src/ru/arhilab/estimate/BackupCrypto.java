package ru.arhilab.estimate;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

public final class BackupCrypto {
  private static final byte[] MAGIC="ARHILAB3".getBytes(StandardCharsets.US_ASCII);
  private static final int ITERATIONS=210000;
  private BackupCrypto(){}
  private static SecretKey key(char[] password,byte[] salt)throws Exception{
    PBEKeySpec spec=new PBEKeySpec(password,salt,ITERATIONS,256);
    try{return new SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(),"AES");}
    finally{spec.clearPassword();}
  }
  public static byte[] encrypt(byte[] plain,char[] password)throws Exception{
    if(password.length<12)throw new IllegalArgumentException("Пароль копии: минимум 12 символов");
    byte[] salt=new byte[16],iv=new byte[12];SecureRandom rng=new SecureRandom();rng.nextBytes(salt);rng.nextBytes(iv);
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(password,salt),new GCMParameterSpec(128,iv));cipher.updateAAD(MAGIC);
    byte[] encrypted=cipher.doFinal(plain),out=new byte[MAGIC.length+salt.length+iv.length+encrypted.length];
    int i=0;System.arraycopy(MAGIC,0,out,i,MAGIC.length);i+=MAGIC.length;System.arraycopy(salt,0,out,i,salt.length);i+=salt.length;System.arraycopy(iv,0,out,i,iv.length);i+=iv.length;System.arraycopy(encrypted,0,out,i,encrypted.length);return out;
  }
  public static boolean isEncrypted(byte[] value){return value.length>MAGIC.length+16+12+16&&Arrays.equals(Arrays.copyOf(value,MAGIC.length),MAGIC);}
  public static byte[] decrypt(byte[] value,char[] password)throws Exception{
    if(!isEncrypted(value))throw new IllegalArgumentException("Неверный формат защищённой копии");
    int i=MAGIC.length;byte[] salt=Arrays.copyOfRange(value,i,i+16);i+=16;byte[] iv=Arrays.copyOfRange(value,i,i+12);i+=12;
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(password,salt),new GCMParameterSpec(128,iv));cipher.updateAAD(MAGIC);
    return cipher.doFinal(value,i,value.length-i);
  }
}
