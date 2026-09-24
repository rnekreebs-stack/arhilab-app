import ru.arhilab.estimate.BackupCrypto;
import ru.arhilab.estimate.PhotoStore;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
public class StorageCryptoTest {
 public static void main(String[] args)throws Exception{
   byte[] plain="Объект, смета, фото".getBytes(StandardCharsets.UTF_8);char[] pwd="очень-длинный-пароль".toCharArray();
   byte[] encrypted=BackupCrypto.encrypt(plain,pwd);if(!BackupCrypto.isEncrypted(encrypted)||!Arrays.equals(plain,BackupCrypto.decrypt(encrypted,pwd)))throw new Error("backup roundtrip");
   try{BackupCrypto.decrypt(encrypted,"incorrect-123456".toCharArray());throw new Error("wrong backup password accepted");}catch(javax.crypto.AEADBadTagException expected){}
   encrypted[encrypted.length-1]^=1;try{BackupCrypto.decrypt(encrypted,pwd);throw new Error("tampered backup accepted");}catch(javax.crypto.AEADBadTagException expected){}
   SecretKey key=KeyGenerator.getInstance("AES").generateKey();File directory=Files.createTempDirectory("arhilab-photos-").toFile();PhotoStore store=new PhotoStore(directory,key);String id=UUID.randomUUID().toString();store.put(id,plain);
   if(!Arrays.equals(store.get(id),plain)||Arrays.equals(Files.readAllBytes(new File(directory,id+".bin").toPath()),plain))throw new Error("photo encryption/roundtrip");
   try{store.get("../bad");throw new Error("path traversal accepted");}catch(IllegalArgumentException expected){}
   store.delete(id);if(new File(directory,id+".bin").exists())throw new Error("photo not deleted");directory.delete();System.out.println("PASS: encrypted backup roundtrip, wrong password, tamper detection; encrypted photo roundtrip, traversal rejection, deletion.");
 }
}
