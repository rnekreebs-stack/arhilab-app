package ru.arhilab.estimate;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class PhotoStore {
  private final File directory;private final SecretKey key;
  public PhotoStore(File directory,SecretKey key){this.directory=directory;this.key=key;if(!directory.isDirectory()&&!directory.mkdirs())throw new IllegalStateException("Каталог фотографий недоступен");}
  private File path(String id){if(!id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))throw new IllegalArgumentException("Неверный ID фото");return new File(directory,id+".bin");}
  public void put(String id,byte[] jpeg)throws Exception{
    File out=path(id),tmp=new File(directory,id+".tmp");
    // AndroidKeyStore generates a fresh GCM IV; supplying one on encryption is forbidden.
    Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);c.updateAAD(id.getBytes("UTF-8"));byte[] encrypted=c.doFinal(jpeg);
    try(FileOutputStream stream=new FileOutputStream(tmp)){stream.write(c.getIV());stream.write(encrypted);stream.getFD().sync();}
    if(!tmp.renameTo(out))throw new IllegalStateException("Не удалось сохранить фото");
  }
  public byte[] get(String id)throws Exception{
    byte[] all=Files.readAllBytes(path(id).toPath());if(all.length<29)throw new IllegalStateException("Файл фото повреждён");
    Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Arrays.copyOfRange(all,0,12)));c.updateAAD(id.getBytes("UTF-8"));return c.doFinal(all,12,all.length-12);
  }
  public void delete(String id){File file=path(id);if(file.exists()&&!file.delete())throw new IllegalStateException("Не удалось удалить фото");}
}
