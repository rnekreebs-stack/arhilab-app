package ru.arhilab.estimate;

public final class MaterialMarkup {
 private MaterialMarkup() {}
 public static int validate(int percent) {
  if(percent!=8 && percent!=10 && percent!=12)throw new IllegalArgumentException("Выберите наценку 8%, 10% или 12%");
  return percent;
 }
 public static double price(double cost,int percent) {
  validate(percent);
  if(!Double.isFinite(cost)||cost<0)throw new IllegalArgumentException("Некорректная закупочная цена");
  return Math.round(cost*(100+percent))/100.0;
 }
}
