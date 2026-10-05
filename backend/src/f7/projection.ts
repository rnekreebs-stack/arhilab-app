/** Strict server-side client projection. Never spread source rows into output. */
export type EstimateRow={title:string;quantity:string;unit:string|null;unit_price:string;coefficient:string;item_kind:string;auto_material:boolean;material_price:string;extra:boolean;extra_status:string|null;stage_name:string|null};
export type EstimateMeta={name:string;project_name:string;address:string|null;client_name:string|null;work_markup_percent:string;delivery_amount:string;discount_amount:string;currency:string|null};
export type Settings={materials:'hidden'|'subtotal'|'detailed';showMaterialPrices:boolean;showSections:boolean;paymentTerms:string;timeline:string;warranty:string;note:string;companyDetails:string};
const scaled=(n:string,places:number)=>{const [whole='0',fraction='']=String(n).split('.');if(!/^\d+$/.test(whole)||!/^\d*$/.test(fraction)||fraction.length>places)throw Error('Invalid decimal');return BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));};
const decimal=(n:bigint)=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
const rounded=(n:bigint,d:bigint)=>(n+d/2n)/d;
export function projectClient(meta:EstimateMeta,source:EstimateRow[],settings:Settings){
  if(meta.currency&&meta.currency!=='RUB')throw Error('Unsupported estimate currency');
  let works=0n,materials=0n;
  const workRows:Array<Record<string,string>>=[],materialRows:Array<Record<string,string>>=[];
  for(const item of source){
    if(item.extra&&!['Согласовано','Выполняется','Выполнено','Оплачено'].includes(item.extra_status??''))continue;
    const quantity=scaled(item.quantity,4),coefficient=scaled(item.coefficient,4);
    const price=scaled(item.unit_price,2),total=rounded(price*quantity*coefficient,100000000n);
    const safe={title:item.title,section:item.stage_name??'Общие работы',unit:item.unit??'шт.',quantity:item.quantity,coefficient:item.coefficient,unitPrice:decimal(price),total:decimal(total)};
    if(item.item_kind==='material'){materials+=total;materialRows.push(safe);continue;}
    works+=total;workRows.push(safe);
    if(item.auto_material){const materialPrice=scaled(item.material_price,2),sum=rounded(materialPrice*quantity,10000n);materials+=sum;
      materialRows.push({title:`Комплект материалов: ${item.title}`,section:item.stage_name??'Материалы',unit:item.unit??'шт.',quantity:item.quantity,coefficient:'1',unitPrice:decimal(materialPrice),total:decimal(sum)});}
  }
  const markup=scaled(meta.work_markup_percent,2),markupAmount=rounded(works*markup,10000n);
  const delivery=scaled(meta.delivery_amount,2),discount=scaled(meta.discount_amount,2),total=works+markupAmount+materials+delivery-discount;
  if(total<0n)throw Error('Negative estimate total');
  const groups=new Map<string,{work:bigint;material:bigint}>();
  for(const [kind,rows] of [['work',workRows],['material',materialRows]] as const)for(const row of rows){
    const name=row.section??'Общие работы',amount=groups.get(name)??{work:0n,material:0n};
    amount[kind]+=scaled(row.total??'0',2);groups.set(name,amount);
  }
  const sections=[...groups.entries()].map(([title,amount])=>({title,workTotal:decimal(amount.work),
    materialTotal:settings.materials==='hidden'?'':decimal(amount.material),
    total:settings.materials==='hidden'?'':decimal(amount.work+amount.material)}));
  return {projectName:meta.project_name,address:meta.address??'',clientName:meta.client_name??'',estimateName:meta.name,
    works:workRows,materials:settings.materials==='detailed'?materialRows.map(row=>settings.showMaterialPrices?row:(({unitPrice:_unitPrice,...safe})=>safe)(row)):[],
    sections,
    workTotal:decimal(works),workMarkup:decimal(markupAmount),materialTotal:settings.materials==='hidden'?'':decimal(materials),
    delivery:decimal(delivery),discount:decimal(discount),total:decimal(total),currency:'RUB',settings};
}
