// Schema-level tests using the PostgreSQL WASM engine PGlite.
// These do not replace service transaction, auth, device or concurrency tests.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const schema = readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8');
await db.exec(schema);
let passed = 0;
async function mustFail(label, sql, params = []) {
  try { await db.query(sql, params); }
  catch (error) {
    if (!['23502','23503','23505','23514','P0001'].includes(error.code)) throw error;
    console.log('PASS', label, error.code); passed++; return;
  }
  throw new Error('Expected rejection: ' + label);
}
async function insert(table, data) {
  const keys=Object.keys(data);
  const r=await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(data));
  return r.rows[0];
}
const gov=await insert('governorates',{name_ar:'محافظة اختبار'});
const branch=await insert('branches',{governorate_id:gov.id,name_ar:'فرع اختبار',latitude:15.35,longitude:44.2});
const other=await insert('branches',{governorate_id:gov.id,name_ar:'فرع آخر',latitude:15.36,longitude:44.21});
const user=await insert('users',{phone_e164:'+967777777777',name_ar:'عميل اختبار',password_hash:'TEST_HASH',kind:'customer',status:'active'});
const courier=await insert('users',{phone_e164:'+967711111111',name_ar:'موصل اختبار',password_hash:'TEST_HASH',kind:'courier',status:'active'});
await insert('courier_profiles',{user_id:courier.id,commission_bps:2000});
const oil=await insert('categories',{name_ar:'زيوت'});
const tires=await insert('categories',{name_ar:'إطارات'});
const attr=await insert('attributes',{code:'viscosity',name_ar:'اللزوجة'});
const size=await insert('attributes',{code:'tire_size',name_ar:'مقاس الإطار'});
const val=await insert('attribute_values',{attribute_id:attr.id,value_ar:'20W50'});
const val2=await insert('attribute_values',{attribute_id:size.id,value_ar:'205/55 R16'});
await insert('category_attributes',{category_id:oil.id,attribute_id:attr.id});
await insert('category_attributes',{category_id:tires.id,attribute_id:size.id});
const product=await insert('products',{sku:'TEST-OIL',category_id:oil.id,name_ar:'زيت تجريبي'});
const product2=await insert('products',{sku:'TEST-OIL-2',category_id:oil.id,name_ar:'زيت آخر'});
await insert('product_attribute_values',{product_id:product.id,category_id:oil.id,attribute_id:attr.id,value_id:val.id});
const unit=await insert('product_units',{product_id:product.id,unit_kind:'piece',pieces_per_unit:1,price_yer:5000});
const carton=await insert('product_units',{product_id:product.id,unit_kind:'carton',pieces_per_unit:12,price_yer:58000});
await insert('stock_levels',{branch_id:branch.id,product_id:product.id,on_hand:27,reserved:0});
await mustFail('negative stock', 'UPDATE stock_levels SET on_hand=-1 WHERE branch_id=$1',[branch.id]);
await mustFail('reserve more than on hand','UPDATE stock_levels SET reserved=28 WHERE branch_id=$1',[branch.id]);
await mustFail('piece conversion must equal one','INSERT INTO product_units(product_id,unit_kind,pieces_per_unit,price_yer) VALUES($1,\'piece\',2,100)',[product2.id]);
await mustFail('carton count must exceed one','INSERT INTO product_units(product_id,unit_kind,pieces_per_unit,price_yer) VALUES($1,\'carton\',1,100)',[product2.id]);
await mustFail('attribute value must belong to attribute','INSERT INTO product_attribute_values VALUES($1,$2,$3,$4)',[product2.id,oil.id,attr.id,val2.id]);
await mustFail('tire property cannot be placed in oils','INSERT INTO product_attribute_values VALUES($1,$2,$3,$4)',[product2.id,oil.id,size.id,val2.id]);
await mustFail('product cannot pretend another category','INSERT INTO product_attribute_values VALUES($1,$2,$3,$4)',[product2.id,tires.id,size.id,val2.id]);
const order=await insert('orders',{customer_id:user.id,governorate_id:gov.id,branch_id:branch.id,kind:'retail',address_snapshot:JSON.stringify({latitude:15.3,longitude:44.2})});
const quote=await insert('order_quotes',{order_id:order.id,branch_id:branch.id,revision:1,subtotal_yer:5000,delivery_yer:450,total_yer:5450,routing_source:'test',distance_m:2400,delivery_rule_snapshot:'{}',expires_at:'2030-01-01T00:00:00Z'});
await insert('quote_items',{quote_id:quote.id,product_id:product.id,unit_id:unit.id,name_snapshot:'زيت',unit_snapshot:'حبة',pieces_per_unit:1,quantity:1,unit_price_yer:5000,line_total_yer:5000});
await mustFail('quote total equality','UPDATE order_quotes SET total_yer=1 WHERE id=$1',[quote.id]);
await mustFail('accepted quote needs acceptance identity','UPDATE order_quotes SET status=\'accepted\' WHERE id=$1',[quote.id]);
await mustFail('quantity must be positive','INSERT INTO quote_items(quote_id,product_id,unit_id,name_snapshot,unit_snapshot,pieces_per_unit,quantity,unit_price_yer,line_total_yer) VALUES($1,$2,$3,\'x\',\'piece\',1,0,100,0)',[quote.id,product.id,unit.id]);
await mustFail('line arithmetic cannot be altered','UPDATE quote_items SET line_total_yer=1 WHERE quote_id=$1',[quote.id]);
await mustFail('unit must belong to same product','INSERT INTO quote_items(quote_id,product_id,unit_id,name_snapshot,unit_snapshot,pieces_per_unit,quantity,unit_price_yer,line_total_yer) VALUES($1,$2,$3,\'x\',\'piece\',1,1,100,100)',[quote.id,product2.id,unit.id]);
await mustFail('reservation branch must match order','INSERT INTO stock_reservations(order_id,branch_id,product_id,quote_id,pieces,expires_at) VALUES($1,$2,$3,$4,1,now()+interval \'30 min\')',[order.id,other.id,product.id,quote.id]);
const assignment=await insert('order_assignments',{order_id:order.id,courier_id:courier.id,assigned_by:user.id,commission_bps:2000,delivery_fee_yer:450,commission_yer:90});
await mustFail('only one active courier assignment','INSERT INTO order_assignments(order_id,courier_id,assigned_by,commission_bps,delivery_fee_yer,commission_yer) VALUES($1,$2,$3,2000,450,90)',[order.id,courier.id,user.id]);
await mustFail('commission must use delivery fee','UPDATE order_assignments SET commission_yer=100 WHERE id=$1',[assignment.id]);
const earning=await insert('courier_earnings',{courier_id:courier.id,order_id:order.id,assignment_id:assignment.id,entry_type:'delivery',amount_yer:90});
await mustFail('one delivery earning per order','INSERT INTO courier_earnings(courier_id,order_id,assignment_id,entry_type,amount_yer) VALUES($1,$2,$3,\'delivery\',90)',[courier.id,order.id,assignment.id]);
const settlement=await insert('courier_settlements',{courier_id:courier.id,paid_by:user.id,total_yer:90,reference:'TEST-SETTLE'});
const settlement2=await insert('courier_settlements',{courier_id:courier.id,paid_by:user.id,total_yer:90,reference:'TEST-SETTLE-2'});
await insert('settlement_items',{settlement_id:settlement.id,earning_id:earning.id});
await mustFail('earning cannot be paid twice','INSERT INTO settlement_items VALUES($1,$2)',[settlement2.id,earning.id]);
await mustFail('financial ledger immutable','UPDATE courier_earnings SET amount_yer=1 WHERE id=$1',[earning.id]);
const movement=await insert('stock_movements',{branch_id:branch.id,product_id:product.id,delta_pieces:-1,reason:'sale',order_id:order.id,actor_id:user.id});
await mustFail('inventory ledger immutable','DELETE FROM stock_movements WHERE id=$1',[movement.id]);
await mustFail('one aggregated sale movement for same order product','INSERT INTO stock_movements(branch_id,product_id,delta_pieces,reason,order_id,actor_id) VALUES($1,$2,-1,\'sale\',$3,$4)',[branch.id,product.id,order.id,user.id]);
await mustFail('Yemen-only canonical number','INSERT INTO users(phone_e164,name_ar,password_hash,kind) VALUES(\'+971777777777\',\'x\',\'x\',\'customer\')');
await mustFail('latest build cannot be less than minimum','INSERT INTO app_releases(app,platform,environment,minimum_build,latest_build,latest_version,store_url) VALUES(\'customer\',\'ios\',\'staging\',5,4,\'1.0\',\'https://example.com\')');
console.log(JSON.stringify({schemaTables:56,negativeConstraintTestsPassed:passed,engine:'PGlite PostgreSQL WASM',scope:'schema constraints only, not application/concurrency/device verification'}));
await db.close();
