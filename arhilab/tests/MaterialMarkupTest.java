import ru.arhilab.estimate.MaterialMarkup;

public class MaterialMarkupTest {
 static void eq(double actual,double expected) {
  if(Double.compare(actual,expected)!=0)throw new AssertionError(actual+" != "+expected);
 }
 public static void main(String[] args) {
  eq(MaterialMarkup.price(100,8),108);
  eq(MaterialMarkup.price(100,10),110);
  eq(MaterialMarkup.price(100,12),112);
  eq(MaterialMarkup.price(1064,8),1149.12);
  eq(MaterialMarkup.price(1064,10),1170.4);
  eq(MaterialMarkup.price(1064,12),1191.68);
  eq(MaterialMarkup.price(0,12),0);
  try {MaterialMarkup.price(100,9);throw new AssertionError("Invalid rate accepted");}
  catch(IllegalArgumentException expected) {}
  try {MaterialMarkup.price(-10,10);throw new AssertionError("Negative cost accepted");}
  catch(IllegalArgumentException expected) {}
  System.out.println("PASS: 8%, 10%, 12% price calculation and invalid values rejected.");
 }
}
