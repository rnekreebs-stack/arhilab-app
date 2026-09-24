import ru.arhilab.estimate.PhotoStore;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.security.*;
import java.security.spec.AlgorithmParameterSpec;
import java.util.Arrays;
import javax.crypto.*;
import javax.crypto.spec.SecretKeySpec;

public class AndroidKeystoreIvTest {
 public static class PolicyProvider extends Provider {
  public PolicyProvider(){super("AndroidIvPolicyTest",1.0,"Simulates AndroidKeyStore GCM IV restriction");put("Cipher.AES/GCM/NoPadding",PolicyCipher.class.getName());}
 }
 public static class PolicyCipher extends CipherSpi {
  private Cipher delegate;
  public PolicyCipher(){try{delegate=Cipher.getInstance("AES/GCM/NoPadding","SunJCE");}catch(Exception e){throw new IllegalStateException(e);}}
  protected void engineSetMode(String mode){} protected void engineSetPadding(String padding){}
  protected int engineGetBlockSize(){return delegate.getBlockSize();}
  protected int engineGetOutputSize(int size){return delegate.getOutputSize(size);}
  protected byte[] engineGetIV(){return delegate.getIV();}
  protected AlgorithmParameters engineGetParameters(){return delegate.getParameters();}
  protected void engineInit(int mode,Key key,SecureRandom random)throws InvalidKeyException{delegate.init(mode,key,random);}
  protected void engineInit(int mode,Key key,AlgorithmParameterSpec params,SecureRandom random)throws InvalidKeyException,InvalidAlgorithmParameterException{
   if(mode==Cipher.ENCRYPT_MODE)throw new InvalidAlgorithmParameterException("Caller-provided IV not permitted");
   delegate.init(mode,key,params,random);
  }
  protected void engineInit(int mode,Key key,AlgorithmParameters params,SecureRandom random)throws InvalidKeyException,InvalidAlgorithmParameterException{
   if(mode==Cipher.ENCRYPT_MODE)throw new InvalidAlgorithmParameterException("Caller-provided IV not permitted");
   delegate.init(mode,key,params,random);
  }
  protected byte[] engineUpdate(byte[] in,int off,int len){return delegate.update(in,off,len);}
  protected int engineUpdate(byte[] in,int off,int len,byte[] out,int outOff)throws ShortBufferException{return delegate.update(in,off,len,out,outOff);}
  protected byte[] engineDoFinal(byte[] in,int off,int len)throws IllegalBlockSizeException,BadPaddingException{return delegate.doFinal(in,off,len);}
  protected int engineDoFinal(byte[] in,int off,int len,byte[] out,int outOff)throws ShortBufferException,IllegalBlockSizeException,BadPaddingException{return delegate.doFinal(in,off,len,out,outOff);}
  protected void engineUpdateAAD(byte[] in,int off,int len){delegate.updateAAD(in,off,len);}
  protected void engineUpdateAAD(ByteBuffer in){delegate.updateAAD(in);}
 }
 public static void main(String[] args)throws Exception{
  Security.insertProviderAt(new PolicyProvider(),1);
  try{
   byte[] keyBytes=new byte[32];new SecureRandom().nextBytes(keyBytes);
   PhotoStore store=new PhotoStore(Files.createTempDirectory("arhilab-iv-").toFile(),new SecretKeySpec(keyBytes,"AES"));
   String id="029364bb-ae5e-4ca7-9f3d-ec923d08ff2d";byte[] photo=new byte[]{1,2,3,4,5};
   store.put(id,photo);
   if(!Arrays.equals(store.get(id),photo))throw new AssertionError("Encrypted photo mismatch");
   store.delete(id);
   System.out.println("PASS: photo encryption and decryption with AndroidKeyStore-style rejection of caller-provided IV.");
  }finally{Security.removeProvider("AndroidIvPolicyTest");}
 }
}
