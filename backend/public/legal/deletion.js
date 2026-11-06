'use strict';
const el=id=>document.getElementById(id),message=el('message');
const labels={verified:'موثق',needs_review:'تحتاج مراجعة',processing:'جارٍ الحذف',completed:'مكتمل',requested:'استلم'};
let challenge=null,device=crypto.randomUUID().replaceAll('-',''),receipt=null,cooldown=0,busy=false;
const say=t=>{message.textContent=t;};
async function api(path,data){const response=await fetch('/web/account-deletion/'+path,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Deletion-Flow':'1'},body:JSON.stringify(data)});const v=await response.json();if(!response.ok)throw Error(v.error?.message||'تعذر الاتصال بالخادم');return v;}
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){say(e.message);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
el('deletion').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{challenge=await api('start',{phone:el('phone').value,app:'web',deviceId:device,confirm:el('confirm').checked});sessionStorage.setItem('tazweed.deletion.receipt',JSON.stringify({id:challenge.requestId,receiptToken:challenge.receiptToken}));el('requestId').value=challenge.requestId;el('receiptToken').value=challenge.receiptToken;cooldown=Date.now()+60000;el('verification').hidden=false;el('deletion').hidden=true;say(challenge.message);});});
el('verification').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{receipt=await api('verify',{app:'web',deviceId:device,challengeId:challenge.challengeId,preauthToken:challenge.preauthToken,code:el('code').value,confirm:true});el('verification').hidden=true;el('receipt').hidden=false;el('requestId').value=receipt.id;el('receiptToken').value=receipt.receiptToken;el('code').value='';challenge=null;say(receipt.notice+' — الحالة: '+(labels[receipt.status]||receipt.status));});});
el('again').onclick=()=>{if(Date.now()<cooldown){say('انتظر60 ثانية قبل طلب رمز جديد');return;}el('verification').hidden=true;el('deletion').hidden=false;challenge=null;};
el('status').onclick=()=>void run(async()=>{const v=await api('status',{requestId:el('requestId').value,receiptToken:el('receiptToken').value});say(v.notice+' — الحالة: '+(labels[v.status]||v.status)+(v.retainedUntil?' — انتهاء المدة: '+v.retainedUntil:''));});
el('recover').onclick=()=>{el('receipt').hidden=false;say('أدخل رقم المتابعة ومفتاحك. إذا فقدتهما وأبقي الحساب للمراجعة، أعد التحقق من رقمك لاسترجاع المتابعة.');};

try{const saved=JSON.parse(sessionStorage.getItem('tazweed.deletion.receipt')||'null');if(saved){el('requestId').value=saved.id;el('receiptToken').value=saved.receiptToken;el('receipt').hidden=false;}}catch{}
