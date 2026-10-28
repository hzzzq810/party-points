var STORE='pps_v10';
var LEGACY_STORE='pps_v9';
var APP_SCHEMA_VERSION=10;
var _toastTimer=null;
/* ── 云同步配置（腾讯云开发 CloudBase）────────────────────────
   1. 到 https://cloud.tencent.com 开通「云开发 CloudBase」，创建环境；
   2. 在控制台拿到「环境 ID」（形如 xxx-1g2h3j4k）填到下面 env；
   3. 控制台「登录授权」里开启「匿名登录」；
   4. 数据库新建集合（默认名 app_state），权限设为「所有用户可读可写」；
   5. 把网站域名加进「Web 安全域名」；
   6. enabled 设为 true 即可启用多设备同步。
   说明：共享密码用于加密数据，云端只存密文，无密码读不到内容。
   ──────────────────────────────────────────────────────── */
var CLOUD={
  enabled:true,
  env:'partypoints-d3g5gwtnz48e590fa',
  collection:'app_state',
  adminUid:'2099738603472580610' // Administrator UID in the existing production environment.
};
var CLOUD_ENABLED=false;
var _cloudApp=null,_cloudKey=null,_cloudSalt=null,_cloudBusy=false,_cloudDirty=false;
if(CLOUD.enabled&&CLOUD.env&&typeof cloudbase!=='undefined'){
  try{_cloudApp=cloudbase.init({env:CLOUD.env});CLOUD_ENABLED=true;}catch(e){console.error('cloudbase init failed',e);}
}
/* ── 加解密工具（Web Crypto：PBKDF2 派生密钥 + AES-GCM）────── */
function _bufToB64(buf){var b=new Uint8Array(buf),s='';for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s);}
function _b64ToBuf(b64){var s=atob(b64),b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b.buffer;}
function _strToBuf(s){return new TextEncoder().encode(s);}
function _bufToStr(buf){return new TextDecoder().decode(buf);}
function _genSalt(){var s=new Uint8Array(16);crypto.getRandomValues(s);return _bufToB64(s.buffer);}
function _deriveKey(pwd,saltB64,exportable){
  return crypto.subtle.importKey('raw',_strToBuf(pwd),'PBKDF2',false,['deriveKey'])
    .then(function(base){return crypto.subtle.deriveKey({name:'PBKDF2',salt:_b64ToBuf(saltB64),iterations:100000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},exportable===true,['encrypt','decrypt']);});
}
function _encrypt(key,str){
  var iv=crypto.getRandomValues(new Uint8Array(12));
  return crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,_strToBuf(str)).then(function(buf){return {iv:_bufToB64(iv.buffer),data:_bufToB64(buf)};});
}
function _decrypt(key,ivB64,dataB64){
  return crypto.subtle.decrypt({name:'AES-GCM',iv:_b64ToBuf(ivB64)},key,_b64ToBuf(dataB64)).then(function(buf){return _bufToStr(buf);});
}
function _exportKey(key){return crypto.subtle.exportKey('jwk',key).then(function(j){return JSON.stringify(j);});}
function _importKey(jwkStr){return crypto.subtle.importKey('jwk',JSON.parse(jwkStr),{name:'AES-GCM'},false,['encrypt','decrypt']);}
/* ── 云同步运行时（CloudBase，密码加密）───────────────────── */
function _cloudLogin(){
  if(!CLOUD.adminUid)return Promise.reject(new Error('尚未配置旧环境管理员用户 ID，请勿发布此版本。'));
  return _cloudApp.auth().getUserInfo().then(function(user){
    var uid=user&&(user.uid||user.sub||user.id);
    if(String(uid||'')!==String(CLOUD.adminUid))throw new Error('请先登录学院管理员账号。');
    return user;
  });
}
var _cloudRecordKey='main';
var _cloudGuard=CloudSync.create(),_cloudConflict=false,_lastSavedPayload=null,_memberChangeSignatures={};
async function _cloudGet(){
  var col=_cloudApp.database().collection(CLOUD.collection);
  var keys=['main_admin_account_v2','main_admin_recovery_v1','main'];
  for(var i=0;i<keys.length;i++){
    var res=await col.where({key:keys[i]}).get();
    if(res&&res.data&&res.data[0]){_cloudRecordKey=keys[i];return res.data[0];}
  }
  _cloudRecordKey='main_admin_account_v2';return null;
}
function _adoptCloudRecord(rec){
  _cloudGuard.adopt(rec);_cloudRecordKey=rec.key;_cloudConflict=false;
  var banner=document.getElementById('cloudConflictBanner');if(banner)banner.classList.add('hide');
}
function _cloudUpsert(saltB64,ivB64,dataB64){
  if(_cloudConflict)return Promise.reject(new Error('保存冲突尚未处理，请先读取云端最新版。'));
  if(dataB64.length>950000)return Promise.reject(new Error('数据接近单条记录容量限制，请先导出完整备份，联系维护人员拆分历史记录。'));
  return _cloudGuard.write(_cloudApp.database().collection(CLOUD.collection),{key:_cloudRecordKey,salt:saltB64,iv:ivB64,data:dataB64,updatedAt:Date.now()});
}
function _downloadFullBackup(label){
  var bk=JSON.parse(JSON.stringify(APP));bk.date=new Date().toISOString();bk.version='v10-workflow1';
  var blob=new Blob([JSON.stringify(bk,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=(label||'积分备份')+'_'+new Date().toLocaleDateString('sv-SE')+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
}
async function reloadLatestCloud(){
  if(!_cloudKey)return toast('请先登录。','err');
  if(_cloudBusy)return toast('正在保存，请稍后再读取。','err');
  if(!confirm('读取云端最新版前，将下载一份当前本机数据备份。当前未同步修改不会自动合并，请之后按备份核对。继续？'))return;
  try{
    var rec=await _cloudGet();if(!rec)throw new Error('未找到云端数据。');
    var plain=await _decrypt(_cloudKey,rec.iv,rec.data),data=JSON.parse(plain);
    if(!data||!data.rules||!Array.isArray(data.members))throw new Error('云端数据格式不正确。');
    _downloadFullBackup('读取云端前的本机备份');
    clearTimeout(_svTimer);_svTimer=null;_cloudDirty=false;_cloudSalt=rec.salt;
    _adoptCloudRecord(rec);_applyData(data);toast('已读取云端最新版；如有本机未同步修改，请对照刚下载的备份处理。');
  }catch(e){toast('读取失败：'+e.message,'err');}
}
function _setCloudSaveState(state,message){
  var el=document.getElementById('cloudSaveState');if(el){el.dataset.state=state;el.textContent=message;}
}
function pushCloud(){
  if(!CLOUD_ENABLED||!_cloudKey){_setCloudSaveState('local','未登录，仅本机保存');return;}
  if(_cloudConflict){_setCloudSaveState('error','有保存冲突，未覆盖云端');return;}
  if(_cloudBusy){_cloudDirty=true;return;}
  var payload=JSON.stringify(APP);if(payload===_lastSavedPayload){_setCloudSaveState('saved','已保存到云端，无新增修改');return;}
  _cloudBusy=true;_setCloudSaveState('saving','正在保存到云端…');
  _encrypt(_cloudKey,payload).then(function(enc){return _cloudUpsert(_cloudSalt,enc.iv,enc.data);}).then(function(){
    _lastSavedPayload=payload;_cloudBusy=false;
    _setCloudSaveState('saved','已保存到云端 '+new Date().toLocaleTimeString('zh-CN',{hour12:false}));
    if(_cloudDirty){_cloudDirty=false;pushCloud();}
  }).catch(function(e){
    _cloudBusy=false;_cloudDirty=false;
    if(e&&e.code==='CLOUD_CONFLICT'){
      _cloudConflict=true;document.getElementById('cloudConflictBanner').classList.remove('hide');
      _setCloudSaveState('error','其他电脑有更新，已阻止覆盖');
    }else _setCloudSaveState('error','云端保存失败，本机修改仍保留');
    toast('云端保存失败：'+(e&&e.message||e),'err');
  });
}
function _rememberKey(key){
  if(window.crypto&&crypto.subtle&&crypto.subtle.exportKey){
    _exportKey(key).then(function(jwk){try{localStorage.setItem('pps_ck',jwk);}catch(e){}});
  }
}
var ADMIN_SESSION_STORE='pps_admin_tab_session_v1';
var ADMIN_SESSION_TTL=8*60*60*1000;
function _forgetKey(){
  try{localStorage.removeItem('pps_ck');}catch(e){}
  try{sessionStorage.removeItem(ADMIN_SESSION_STORE);}catch(e){}
}
async function _rememberAdminSession(key,salt){
  try{
    var jwk=await _exportKey(key);
    sessionStorage.setItem(ADMIN_SESSION_STORE,JSON.stringify({uid:String(CLOUD.adminUid),env:CLOUD.env,recordKey:'main_admin_account_v2',salt:salt,jwk:jwk,expiresAt:Date.now()+ADMIN_SESSION_TTL}));
  }catch(e){toast('本窗口无法保留登录状态，刷新后需重新登录。','err');}
}
function setLoginErr(m){var el=document.getElementById('loginErr');if(el){el.textContent=m||'';if(m)el.scrollIntoView({block:'nearest'});}}
function _applyData(data){
  if(data&&data.rules&&Array.isArray(data.members)){
    if(!data.schemaVersion)data.schemaVersion=APP_SCHEMA_VERSION;
    if(!data.criteriaVersion)data.criteriaVersion=APP_SCHEMA_VERSION;
    if(!data.summaryMode)data.summaryMode='detail';
    if(!data.learnedMap)data.learnedMap={};
    APP=data;BatchCore.ensure(APP);AdminCore.ensure(APP);_auditSnapshot=AdminCore.snapshot(APP);R=APP.rules;
    if(APP._sortCol!=null)_sumSortCol=APP._sortCol;
    if(APP._sortDir!=null)_sumSortDir=APP._sortDir;
    try{localStorage.setItem(STORE,JSON.stringify(APP));}catch(e){}
    document.getElementById('statusBar').textContent='已从云端同步';
  }else{
    document.getElementById('statusBar').textContent='云端数据为空';
  }
  document.getElementById('loginBg').classList.remove('on');
  renderCriteria();render();updateUncStats();
  _resetMemberChangeSignatures();_writeLocal();_lastSavedPayload=JSON.stringify(APP);
  _setCloudSaveState('saved','已读取云端数据');
}
function unlockCloudData(){
  var pwd=document.getElementById('loginPwd').value.trim();
  if(!pwd){setLoginErr('请输入共享密码');return;}
  setLoginErr('');
  _cloudLogin().then(function(){return _cloudGet();}).then(function(rec){
    if(!rec){throw new Error('旧环境未找到积分数据，已停止，未创建或覆盖数据。');}
    return _deriveKey(pwd,rec.salt).then(function(key){
      return _decrypt(key,rec.iv,rec.data).then(function(plain){
        _cloudKey=key;_cloudSalt=rec.salt;
        _rememberKey(key);
        _applyData(JSON.parse(plain));
      },function(){setLoginErr('管理员验证已通过，但数据解锁密码不正确。忘记密码可从 JSON 备份恢复。');});
    });
  }).catch(function(e){setLoginErr('登录失败：'+(e&&e.message||e));});
}
function _doFirstTime(pwd){
  var salt=_genSalt();
  return _deriveKey(pwd,salt).then(function(key){
    _cloudKey=key;_cloudSalt=salt;
    _rememberKey(key);
    return _encrypt(key,JSON.stringify(APP)).then(function(enc){
      return _cloudUpsert(salt,enc.iv,enc.data).then(function(){
        document.getElementById('loginBg').classList.remove('on');
        document.getElementById('statusBar').textContent='云端已初始化，本地数据已上传';
        renderCriteria();render();updateUncStats();
      });
    });
  });
}
async function _tryAutoLogin(){
  var session;
  try{session=JSON.parse(sessionStorage.getItem(ADMIN_SESSION_STORE)||'null');}catch(e){_forgetKey();return false;}
  if(!session)return false;
  if(session.uid!==String(CLOUD.adminUid)||session.env!==CLOUD.env||session.recordKey!=='main_admin_account_v2'||!session.salt||!session.jwk||!Number.isFinite(session.expiresAt)||session.expiresAt<=Date.now()){
    _forgetKey();setLoginErr('登录已过期，请重新输入管理员账号和密码。');return false;
  }
  _adminLoginBusy=true;document.getElementById('btnLogin').disabled=true;
  setLoginErr('正在恢复登录并读取云端最新数据…');
  try{
    await _cloudLogin();
    var rec=await _cloudGet();
    if(!rec||rec.key!==session.recordKey||rec.salt!==session.salt)throw new Error('共享数据已变化，请重新登录。');
    var key=await _importKey(session.jwk),plain=await _decrypt(key,rec.iv,rec.data),data=JSON.parse(plain);
    if(!data||!data.rules||!Array.isArray(data.members))throw new Error('云端数据格式不正确。');
    _cloudKey=key;_cloudSalt=rec.salt;_adoptCloudRecord(rec);_applyData(data);setLoginErr('');return true;
  }catch(e){
    _cloudKey=null;_cloudSalt=null;_forgetKey();document.getElementById('loginBg').classList.add('on');
    setLoginErr('登录状态未能恢复，请重新登录。若网络异常，请稍后重试。');return false;
  }finally{_adminLoginBusy=false;document.getElementById('btnLogin').disabled=false;}
}
async function tryLogin(){
  if(_adminLoginBusy)return;
  if(!CLOUD.adminUid){setLoginErr('尚未配置管理员 ID。');return;}
  var username=document.getElementById('loginUsername').value.trim();
  var password=document.getElementById('loginAccountPwd').value;
  if(!username||!password){setLoginErr('请输入管理员账号和密码。');return;}
  _adminLoginBusy=true;document.getElementById('btnLogin').disabled=true;
  _cloudKey=null;_cloudSalt=null;
  try{
    setLoginErr('正在登录…');
    var result=await _cloudApp.auth().signInWithPassword({username:username,password:password});
    if(result&&result.error)throw result.error;
    await _cloudLogin();
    var rec=await _cloudGet();
    if(!rec||rec.key!=='main_admin_account_v2'){
      document.getElementById('recoverySection').open=true;
      setLoginErr('管理员账号验证成功，但尚未发现新版共享数据。历史数据恢复仅需由维护管理员完成一次，其他电脑无需重复上传。');return;
    }
    var key=await _deriveKey(password,rec.salt,true),plain;
    try{plain=await _decrypt(key,rec.iv,rec.data);}catch(e){
      throw new Error('账号验证成功，但数据无法解锁。如果管理员密码曾被重置，需要使用备份重新配置；请勿删除云端数据。');
    }
    var data=JSON.parse(plain);_cloudKey=key;_cloudSalt=rec.salt;_adoptCloudRecord(rec);
    _forgetKey();await _rememberAdminSession(key,rec.salt);_applyData(data);document.getElementById('loginAccountPwd').value='';setLoginErr('');
  }catch(e){setLoginErr('登录失败：'+(e&&e.message||e));}
  finally{_adminLoginBusy=false;document.getElementById('btnLogin').disabled=false;}
}
var _adminLoginBusy=false;
function doLogout(){
  if(!confirm('确认退出管理员账号？'))return;
  clearTimeout(_svTimer);_svTimer=null;
  _forgetKey();_cloudKey=null;_cloudSalt=null;
  _cloudApp.auth().signOut().then(function(){location.reload();},function(){
    document.getElementById('loginBg').classList.add('on');setLoginErr('退出失败，请重试。');
  });
}
async function recoverFromBackup(){
  if(_adminLoginBusy)return;
  var file=document.getElementById('recoveryFile').files[0];
  var account=document.getElementById('loginAccountPwd').value;
  var username=document.getElementById('loginUsername').value.trim();
  if(!file||!account||!username){setLoginErr('请选择 JSON 备份，并重新填写上方管理员账号和登录密码。');return;}
  _adminLoginBusy=true;document.getElementById('btnRecover').disabled=true;
  var saved=false;
  try{
    var data=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
    if(!data||!data.rules||typeof data.rules!=='object'||Array.isArray(data.rules)||!Array.isArray(data.members))throw new Error('备份格式不正确，需要网站导出的完整 JSON 文件。');
    var result=await _cloudApp.auth().signInWithPassword({username:username,password:account});
    if(result&&result.error)throw result.error;
    await _cloudLogin();
    var col=_cloudApp.database().collection(CLOUD.collection);
    var existing=await col.where({key:'main_admin_account_v2'}).get();
    if(existing.data&&existing.data.length)throw new Error('单密码版数据已经存在，已停止，未覆盖。请用管理员账号和密码登录。');
    if(!confirm('备份包含 '+data.members.length+' 位成员。将创建独立恢复数据，不修改原 main 记录。旧网址仍使用原记录，期间请勿两边同时录入。确认恢复？'))return;
    var salt=_genSalt(),key=await _deriveKey(account,salt,true);
    var enc=await _encrypt(key,JSON.stringify(data));
    var recoveredRecord={_id:'admin_account_v2',key:'main_admin_account_v2',salt:salt,iv:enc.iv,data:enc.data,revision:1,updatedAt:Date.now(),recoveredAt:Date.now()};
    await col.add(recoveredRecord);_adoptCloudRecord(recoveredRecord);
    saved=true;_cloudRecordKey='main_admin_account_v2';_cloudKey=key;_cloudSalt=salt;
    _forgetKey();await _rememberAdminSession(key,salt);_applyData(data);
    document.getElementById('loginAccountPwd').value='';
    document.getElementById('statusBar').textContent='已从备份恢复；原云端记录保留。';
    toast('恢复完成。以后只需管理员账号和密码登录。');
  }catch(e){
    setLoginErr((saved?'恢复数据已写入，但显示失败，请刷新后用管理员账号和密码登录：':'恢复未完成：')+(e&&e.message||e));
  }finally{_adminLoginBusy=false;document.getElementById('btnRecover').disabled=false;}
}
window.addEventListener('error',function(e){if(e.message&&e.message.indexOf('runtime.lastError')>=0){e.preventDefault();}},true);
/* ── 全局点击关闭悬浮分数卡片兜底 ── */
document.addEventListener('click',function(e){if(!e.target.closest('.mitem')){var tips=document.querySelectorAll('.member-tooltip');for(var i=0;i<tips.length;i++)tips[i].remove();}});
function toast(msg,type){var el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.className='toast on'+(type==='err'?' toast-err':'');clearTimeout(_toastTimer);_toastTimer=setTimeout(function(){el.classList.remove('on');},2800);}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function setProcessLoading(on){var btn=document.getElementById('btnProcess');if(!btn)return;if(on){btn.dataset.prevText=btn.textContent;btn.textContent='处理中…';btn.classList.add('is-loading');btn.disabled=true;}else{btn.textContent=btn.dataset.prevText||'开始处理';btn.classList.remove('is-loading');btn.disabled=!pf;}}
function countAllUncertain(){var n=0;for(var i=0;i<APP.members.length;i++){classifyMember(APP.members[i]);n+=(APP.members[i]._unc&&APP.members[i]._unc.length)||0;}return n;}
function updateUncStats(){var n=countAllUncertain();var g=document.getElementById('globalUncBadge');if(g){if(n>0){g.textContent='待处理 '+n+' 项';g.classList.remove('hide');}else g.classList.add('hide');}var s=document.getElementById('sideUncHint');if(s){if(n>0){s.textContent='全库共 '+n+' 项待归类';s.classList.remove('hide');}else s.classList.add('hide');}}
function switchMainTab(tb){document.querySelectorAll('#mainTabs .tab').forEach(function(x){x.classList.remove('active');});var te=document.querySelector('#mainTabs .tab[data-tab="'+tb+'"]');if(te)te.classList.add('active');document.getElementById('panelOverview').classList.toggle('hide',tb!=='overview');document.getElementById('panelDetail').classList.toggle('hide',tb!=='detail');document.getElementById('panelUncertain').classList.toggle('hide',tb!=='uncertain');document.getElementById('panelCriteria').classList.toggle('hide',tb!=='criteria');var hideScore=tb==='criteria';document.getElementById('scoreSection').classList.toggle('hide',hideScore);}
function openCriteriaTab(){document.getElementById('viewSummary').classList.add('hide');document.getElementById('emptyState').classList.add('hide');document.getElementById('viewPersonal').classList.remove('hide');switchMainTab('criteria');renderCriteria();}
function openUncertainTab(){if(!APP.members.length)return;document.getElementById('viewSummary').classList.add('hide');document.getElementById('emptyState').classList.add('hide');document.getElementById('viewPersonal').classList.remove('hide');switchMainTab('uncertain');render();}
function openGlobalUncertain(){
  if(!APP.members.length)return;
  // Collect all uncertain items from all members
  var allItems=[];
  for(var i=0;i<APP.members.length;i++){
    var m=APP.members[i];classifyMember(m);
    if(m._unc&&m._unc.length>0){
      for(var j=0;j<m._unc.length;j++){
        allItems.push({memberIdx:i,name:m['姓名']||'?',cls:m['班级']||'',unc:m._unc[j],uncIdx:j});
      }
    }
  }
  if(!allItems.length){alert('全部成员暂无不确定项');return;}
  // Group by guessed category
  var groups={};
  for(var k=0;k<allItems.length;k++){
    var gn=allItems[k].unc.cl.n||'其他';
    if(!groups[gn])groups[gn]=[];
    groups[gn].push(allItems[k]);
  }
  var m2='<h3>全局不确定项 ('+allItems.length+'项·'+Object.keys(groups).length+'组)</h3>';
  m2+='<div class=\"batch-bar\" style=\"margin-bottom:10px\"><label style=\"cursor:pointer\"><input type=\"checkbox\" onchange=\"var c=this.checked;document.querySelectorAll(\'.gunc-cb\').forEach(function(cb){cb.checked=c;});\"> 全选</label><select id=\"gbatchCat\" onchange=\"onGBatchCatChange()\"><option value=\"\">-- 批量归类到 --</option>';
  for(var i=0;i<AC.length;i++)m2+='<option value=\"ac-'+i+'\">学业-'+AC[i]+'</option>';
  for(var i=0;i<PS.length;i++)m2+='<option value=\"pt-'+i+'\">党性-'+PS[i]+'</option>';
  for(var i=0;i<DS.length;i++)m2+='<option value=\"dc-'+i+'\">纪律-'+DS[i]+'</option>';
  m2+='</select><input type=\"number\" id=\"gbatchScore\" value=\"0\" step=\"0.1\" style=\"width:60px\"><select id=\"gbatchLevel\" style=\"display:none\"></select><button class=\"btn btn-p btn-s\" id=\"btnGBatchFix\">批量归类选中</button><button class=\"btn btn-g btn-s\" id=\"btnGBatchIgnore\">忽略选中</button></div>';
  for(var gn in groups){
    var items=groups[gn];
    m2+='<div class=\"unc-group\"><div class=\"unc-group-title\">'+gn+' ('+items.length+'项)</div>';
    for(var k=0;k<items.length;k++){
      var it=items[k],u=it.unc;
      m2+='<div class=\"unc-item\"><input type=\"checkbox\" class=\"gunc-cb\" data-midx=\"'+it.memberIdx+'\" data-uidx=\"'+it.uncIdx+'\">['+(u.type=='award'?'奖':'活')+'] <b>'+esc(u.raw.substring(0,60))+'</b> <span style=\"font-size:11px;color:var(--mut)\">'+esc(it.name)+' · '+esc(it.cls)+'</span> <button class=\"btn btn-p btn-s\" data-gfix=\"'+k+'\" data-midx=\"'+it.memberIdx+'\" data-uidx=\"'+it.uncIdx+'\">归类</button> <button class=\"btn btn-g btn-s\" data-gign=\"'+k+'\" data-midx=\"'+it.memberIdx+'\" data-uidx=\"'+it.uncIdx+'\">忽略</button></div>';
    }
    m2+='</div>';
  }
  m2+='<div class=\"modal-acts\"><button class=\"btn\" onclick=\"closeModal()\">关闭</button></div>';
  document.getElementById('modalBox').innerHTML=m2;
  document.getElementById('modalBg').style.display='flex';
  // Bind individual fix buttons
  var fixBtns=document.querySelectorAll('#modalBox [data-gfix]');
  for(var i=0;i<fixBtns.length;i++){fixBtns[i].onclick=(function(b){return function(){
    var mi=parseInt(b.getAttribute('data-midx')),ui=parseInt(b.getAttribute('data-uidx'));
    closeModal();
    APP.curIdx=mi;
    setTimeout(function(){quickFix(ui);},300);
  };})(fixBtns[i]);}
  // Bind individual ignore buttons
  var ignBtns=document.querySelectorAll('#modalBox [data-gign]');
  for(var i=0;i<ignBtns.length;i++){ignBtns[i].onclick=(function(b){return function(){
    var mi=parseInt(b.getAttribute('data-midx')),ui=parseInt(b.getAttribute('data-uidx'));
    var m=APP.members[mi];if(!m||!m._unc[ui])return;m._unc.splice(ui,1);
    setTimeout(function(){openGlobalUncertain();},300);
  };})(ignBtns[i]);}
  // Batch fix
  document.getElementById('btnGBatchFix').onclick=function(){
    var bv=document.getElementById('gbatchCat').value;if(!bv)return alert('请选择目标分类');
    var parts=bv.split('-'),board=parts[0],si=parseInt(parts[1]);
    var cbs=document.querySelectorAll('.gunc-cb:checked');if(!cbs.length)return alert('请勾选项目');
    if(!confirm('确定将 '+cbs.length+' 个项目批量归类？'))return;
    var toRemove={};cbs.forEach(function(cb){
      var mi=parseInt(cb.getAttribute('data-midx')),ui=parseInt(cb.getAttribute('data-uidx'));
      var m=APP.members[mi];if(!m||!m._unc[ui])return;
      var arr=board=='ac'?m._cl.ac[si]:(board=='pt'?m._cl.pt[si]:m._cl.dc[si]);
      var sc=parseFloat(document.getElementById('gbatchScore').value)||0;
      var lv=document.getElementById('gbatchLevel');if(lv&&lv.style.display!=='none'&&lv.value){var li=parseInt(lv.value);var lc=getLevelCat(board,si,'');if(lc&&R.levelAward[lc]){sc=R.levelAward[lc].sc[li];}}
      arr.push({raw:m._unc[ui].raw,score:sc,level:'',lk:'ls',auto:false});
      if(!toRemove[mi])toRemove[mi]=[];toRemove[mi].push(ui);
    });
    for(var mi in toRemove){toRemove[mi].sort(function(a,b){return b-a;});toRemove[mi].forEach(function(ui){APP.members[mi]._unc.splice(ui,1);});}
    sv();render();setTimeout(function(){openGlobalUncertain();},300);
  };
  // Batch ignore
  document.getElementById('btnGBatchIgnore').onclick=function(){
    var cbs=document.querySelectorAll('.gunc-cb:checked');if(!cbs.length)return;
    var toRemove={};cbs.forEach(function(cb){var mi=parseInt(cb.getAttribute('data-midx')),ui=parseInt(cb.getAttribute('data-uidx'));if(!toRemove[mi])toRemove[mi]=[];toRemove[mi].push(ui);});
    for(var mi in toRemove){toRemove[mi].sort(function(a,b){return b-a;});toRemove[mi].forEach(function(ui){APP.members[mi]._unc.splice(ui,1);});}
    sv();render();setTimeout(function(){openGlobalUncertain();},300);
  };
}
function loadApp(){var def={rules:JSON.parse(JSON.stringify(DEF)),members:[],curIdx:0,coef:false,learnedMap:{},schemaVersion:APP_SCHEMA_VERSION,criteriaVersion:APP_SCHEMA_VERSION,summaryMode:'detail'};try{var s=localStorage.getItem(STORE);if(s){var a=JSON.parse(s);if(!a.schemaVersion)a.schemaVersion=10;if(!a.criteriaVersion)a.criteriaVersion=a.schemaVersion||10;if(!a.summaryMode)a.summaryMode='detail';return a;}var leg=localStorage.getItem(LEGACY_STORE);if(leg){var a2=JSON.parse(leg);a2.schemaVersion=10;a2.criteriaVersion=10;a2.summaryMode='detail';try{localStorage.setItem(STORE,JSON.stringify(a2));}catch(e){}return a2;}}catch(e){}return def;}
var DEF={levelAward:{'学科竞赛':{lv:['国家级','省级','市级','校级/协会级','院级'],sc:[8,6,4,3,2],mode:'level'},'创新创业':{lv:['国家级','省级','市级','校级/协会级','院级'],sc:[8,6,4,3,2],mode:'level'},'社会实践成果':{lv:['国家级','省级','市级','校级/协会级','院级'],sc:[8,6,4,3,2],mode:'level'},'奖学金':{lv:['国家奖学金','国家励志奖学金','校一等奖学金','校二等奖学金','校三等奖学金'],sc:[8,6,4,3,2],mode:'level'},'荣誉称号':{lv:['优秀团员/团干/学生骨干','优秀学员','志愿者之星/优秀志愿者','标兵/十佳'],sc:[3,2,2,4],mode:'level'},'体育赛事获奖':{lv:['国家级赛事','省级赛事','市级赛事','校级/协会赛事','院级赛事'],sc:[7,5,3,2,1],mode:'level'},'体育竞赛':{lv:['国家级','省级','市级','校级/协会级','院级'],sc:[7,5,3,2,1],mode:'level'},'志愿服务':{lv:['国家级赛事服务','市级服务','区级服务','校级服务','院级服务'],sc:[8,5,3,2,1],mode:'hourly',rate:0.25,cap:8}},socialWork:{'校级主席/部长':8,'校级副主席/副部长':6,'院级主席/部长':6,'班长/团支书':5,'副班长':4,'其他班委/院级干事/校级干事':3},perActivity:{'党课学习':5,'红心活动':3,'社会实践':5,'国际交流':2,'同辈互助':2},caps:{'国际交流':8,'志愿服务':10},volunteer:{rate:0.5,cap:10},rank:{top5:6,top10:3,top20:1},discipline:{fail:-3,warning:-5,severeWarning:-10,demerit:-20},acCap:40,ptCap:60};
function ld(k,d){try{var s=localStorage.getItem(k);return s?JSON.parse(s):JSON.parse(JSON.stringify(d));}catch(e){return JSON.parse(JSON.stringify(d));}}
var _svTimer=null;
function _memberChangeSignature(m){var copy=Object.assign({},m);delete copy._updatedAt;return BatchCore.signature({members:[copy]});}
function _resetMemberChangeSignatures(){_memberChangeSignatures={};APP.members.forEach(function(m){_memberChangeSignatures[m._memberId]=_memberChangeSignature(m);});}
function _touchMemberChanges(){BatchCore.ensure(APP);APP.members.forEach(function(m){var current=_memberChangeSignature(m);if(_memberChangeSignatures[m._memberId]!=null&&_memberChangeSignatures[m._memberId]!==current)m._updatedAt=new Date().toISOString();_memberChangeSignatures[m._memberId]=current;});}
function _writeLocal(){APP.members.forEach(_captureManualItems);_touchMemberChanges();_auditSnapshot=AdminCore.record(APP,_auditSnapshot);APP.schemaVersion=APP_SCHEMA_VERSION;if(APP.criteriaVersion==null)APP.criteriaVersion=APP_SCHEMA_VERSION;try{localStorage.setItem(STORE,JSON.stringify(APP));}catch(e){toast('保存失败：数据可能过大，请先导出备份','err');}}
function svNow(){clearTimeout(_svTimer);_svTimer=null;_writeLocal();pushCloud();}
function sv(){
  APP.schemaVersion=APP_SCHEMA_VERSION;if(APP.criteriaVersion==null)APP.criteriaVersion=APP_SCHEMA_VERSION;
  if(CLOUD_ENABLED&&_cloudKey&&!_cloudConflict)_setCloudSaveState('saving','有修改，等待保存到云端…');
  clearTimeout(_svTimer);_svTimer=setTimeout(function(){_svTimer=null;_writeLocal();pushCloud();},300);
}
function _hasPendingCloudChanges(){return !!(CLOUD_ENABLED&&_cloudKey&&(_cloudBusy||_cloudDirty||_cloudConflict||JSON.stringify(APP)!==_lastSavedPayload));}
window.addEventListener('beforeunload',function(e){
  clearTimeout(_svTimer);_svTimer=null;_writeLocal();
  if(_hasPendingCloudChanges()){
    e.preventDefault();e.returnValue='';
    if(!_cloudBusy&&!_cloudConflict)pushCloud();
  }
});

var APP=loadApp();BatchCore.ensure(APP);AdminCore.ensure(APP);var _auditSnapshot=AdminCore.snapshot(APP);_resetMemberChangeSignatures();
// 恢复上次排序状态（纯 UI 状态，不影响数据结构）
if(APP._sortCol!=null)_sumSortCol=APP._sortCol;
if(APP._sortDir!=null)_sumSortDir=APP._sortDir;
var R=APP.rules;var AC=['学业成绩','综合测评','社会工作','学科竞赛','创新创业','奖学金/荣誉'];var PS=['党课学习','志愿服务','红心活动','社会实践','国际交流','同辈互助'];var DS=['不当言论','挂科','无故缺席','网络违纪','纪律处分'];var ALL_LV=['国家级','省级','市级','校级/协会级','院级'];
function fc(obj,kws){for(var i=0;i<kws.length;i++)for(var k in obj)if(k.indexOf(kws[i])>=0&&obj[k]!==undefined&&obj[k]!==null&&obj[k]!=='')return k;return'';}
function rk(s){if(!s)return null;var m=String(s).match(/(\d+)\s*\/\s*(\d+)/);return m?{r:parseInt(m[1]),t:parseInt(m[2]),p:parseInt(m[1])/parseInt(m[2])}:null;}
function sr(r){if(!r)return 0;if(r.p<=.05)return R.rank.top5;if(r.p<=.10)return R.rank.top10;if(r.p<=.20)return R.rank.top20;return 0;}
function dlv(t){
  t=String(t||'').normalize('NFKC');
  // Award stages take precedence over a nationwide competition title.
  if(/院级|院赛|院内选拔|学院选拔/.test(t))return{n:'院级',k:'ly',known:true};
  if(/校级|校赛|校内选拔|校内赛|学校选拔/.test(t))return{n:'校级/协会级',k:'ls',known:true};
  if(/省级|省赛|省决赛|省内选拔|省一等奖|省二等奖|省三等奖|(?:广东|浙江|江苏|福建|山东|湖南|湖北|四川|河南|河北|安徽|江西|云南|贵州|海南|山西|陕西|甘肃|青海|吉林|辽宁|黑龙江)省/.test(t))return{n:'省级',k:'lp',known:true};
  if(/市级|市赛|市决赛|市内选拔/.test(t))return{n:'市级',k:'lm',known:true};
  if(/国家级|国赛|国奖|全国(?:总)?决赛|全国赛|国际(?:总)?决赛/.test(t))return{n:'国家级',k:'ln',known:true};
  return{n:'级别待确认',k:'ls',known:false};
}

function getLvScore(cn,ln){var c=R.levelAward[cn];if(!c)return 0;var i=c.lv.indexOf(ln);return i>=0?c.sc[i]:c.sc[c.sc.length-1]||0;}
function sp(t){
  if(t==null)return[];
  var text=String(t).replace(/\r\n?/g,'\n').replace(/[；;]/g,'\n');
  // Numbered lists must start at a boundary; preserve decimals and dates.
  text=text.replace(/(^|[\n\s])(?:[1-9]\d?[、)）]|[1-9]\d?\.(?!\d))/g,'\n');
  var out=[];
  text.split('\n').forEach(function(line){
    line=line.replace(/^\s*[-*•]\s*/,'').trim();
    if(!line||/^(无|暂无|没有|无获奖|无获奖情况|-|—)$/.test(line))return;
    // Split a Chinese list only when each segment independently names an award.
    var parts=line.split('、');
    if(parts.length>1&&parts.every(function(x){return /奖|荣誉|称号/.test(x);})){
      parts.forEach(function(x){if(x.trim())out.push(x.trim());});
    }else out.push(line);
  });
  return out;
}
function _isTemplateExample(row){return (row['姓名']||row['名字']||'')==='张三（填写示例，请删除或替换）';}
function _awardIdentity(raw){return String(raw||'').normalize('NFKC').replace(/\s+/g,'').replace(/[，,。;；]/g,'');}
function _dedupeExactAwards(arr){
  var seen={};
  for(var i=arr.length-1;i>=0;i--){var key=_awardIdentity(arr[i].raw);if(seen[key])arr.splice(i,1);else seen[key]=true;}
}
function _captureManualItems(m){
  if(!m._cl)return;
  m._manualItems=[];
  ['ac','pt','dc'].forEach(function(cat){(m._cl[cat]||[]).forEach(function(items,si){items.forEach(function(item){
    if(item.auto===false)m._manualItems.push({cat:cat,si:si,item:JSON.parse(JSON.stringify(item))});
  });});});
}
function _restoreManualItems(m){
  (m._manualItems||[]).forEach(function(saved){
    ['ac','pt','dc'].forEach(function(cat){m._cl[cat].forEach(function(items){for(var i=items.length-1;i>=0;i--){if(_awardIdentity(items[i].raw)===_awardIdentity(saved.item.raw))items.splice(i,1);}});});
    m._unc=m._unc.filter(function(u){return _awardIdentity(u.raw)!==_awardIdentity(saved.item.raw);});
    if(m._cl[saved.cat]&&m._cl[saved.cat][saved.si])m._cl[saved.cat][saved.si].push(JSON.parse(JSON.stringify(saved.item)));
  });
}

function parseVolHours(s){if(!s)return 0;s=String(s).replace(/小?时/g,'小时').replace(/分[钟]?/g,'分钟');var h=0,m=0,hm=s.match(/(\d+)\s*小时/),mm=s.match(/(\d+)\s*分/);if(hm)h=parseInt(hm[1]);if(mm)m=parseInt(mm[1]);if(!hm&&!mm){var n=parseFloat(s);if(!isNaN(n))h=n;}return Math.round((h+m/60)*100)/100;}
function fmt(n){return Math.abs(n-Math.round(n))<0.05?Math.round(n):n.toFixed(1);}
function ca(t){t=t.trim();if(!t)return null;var lm=APP.learnedMap&&APP.learnedMap[t];if(lm)return JSON.parse(JSON.stringify(lm));var vm=(R.levelAward['志愿服务']&&R.levelAward['志愿服务'].mode)||'level';if(/志愿/.test(t)&&!/奖|星|优秀|先进|表彰/.test(t)&&!/大赛|竞赛/.test(t)){if(vm=='per'){var vp=R.levelAward['志愿服务'].perVal||2;return{c:'party',i:1,n:'志愿服务',p:vp,cf:.9};}return{c:'party',i:1,n:'志愿服务活动',p:0,cf:1,sk:1};}var r=[],v1=R.perActivity['党课学习']||5,v2=R.perActivity['红心活动']||3,v3=R.perActivity['社会实践']||5,v4=R.perActivity['国际交流']||2,v5=R.perActivity['同辈互助']||2;if(/党课|党校|入党积极分子培训|发展对象培训|青马工程|党员培训|团校/.test(t))r.push({c:'party',i:0,n:'党课学习',p:v1,cf:.95});if(/(?:纪念馆|博物馆|红色基地|革命旧址|党史馆|烈士陵园|红色景点)/.test(t)&&/党课|党校|培训/.test(t))r.push({c:'party',i:0,n:'党课学习',p:v1,cf:.9});if(/升旗|植树|养老院|敬老院|祭扫|扫墓|缅怀先烈/.test(t))r.push({c:'party',i:2,n:'红心活动',p:v2,cf:.9});if(/红色|纪念馆|博物馆|革命|党史|烈士|缅怀|红色基因|爱国|长征|研学|红色基地|革命旧址|党史馆|烈士陵园/.test(t)&&!/党课|党校|培训/.test(t))r.push({c:'party',i:2,n:'红心活动',p:v2,cf:.85});if(/社会实践|三下乡|调研|千股工程|双百行动|乡村振兴|直联|支教|寒暑假实践|百千万|电商助农|直播助农|调研报告|走访调研|红色实践/.test(t))r.push({c:'party',i:3,n:'社会实践',p:v3,cf:.85,sp:1});if(/(?:中外交流|留学生|外籍|海外|foreign|exchange|国际文化|跨境)/.test(t))r.push({c:'party',i:4,n:'国际交流',p:v4,cf:.85});else if(/国际交流/.test(t)&&!/国际交流学院|学院/.test(t))r.push({c:'party',i:4,n:'国际交流',p:v4,cf:.80});if(/思政|形势政策|主题团日|主题班会|思想汇报|青年大学习|团课|团日/.test(t))r.push({c:'party',i:2,n:'红心活动',p:v2,cf:.82});if(/党日|支部|党建|党员大会|组织生活|民主评议|主题党日/.test(t)&&!/培训|党课|党校/.test(t))r.push({c:'party',i:2,n:'红心活动',p:v2,cf:.8});if(/迎新|运动会|开幕式|[Mm][Vv]|献血|巡逻|军训|晚会|讲座|观众|乒乓|毕业|典礼|体检|[Cc][Pp][Rr]|职业规划|高招|咨询|食堂|查寝|值班|协助|布置|排练|扫除|劳动|啦啦|方阵|拔河|趣味|篮球|足球|排球|羽毛球|网球|合唱|朗诵|主持|礼仪|接待|引导|维持|后勤|布场|撤场|机动|工作人员|带队|宣传|招新|纳新|社团|文艺|演出|歌唱|舞蹈|乐器|辩论|演讲|体育|学院.*活动|活动.*学院|院内|巡查|助班|新生|大会|研讨|表演|演唱|录制|拍摄|制作|海报|艺术节|文化节|读书会|欢送会|音乐会|辅导员|医疗|采访|访谈|座谈|沙龙|论坛|分享会|报告会|团建|素拓|观摩|走访|参观|集训|拓展|例会|培训|竞赛|比赛|视频|宣传片|纪录片|新闻|编辑|撰写|写稿|总结|汇报|答辩|面试|评选|考核|检查|督导|执勤|守卫|安保|广播|摄影|摄像|设计|绘画|书法|征文|策划|组织.*活动|班级活动|社团活动|文体活动|学生活动|团日活动|实践/.test(t))r.push({c:'party',i:5,n:'同辈互助',p:v5,cf:.75});if(r.length===0&&/活动|参加|参与|组织/.test(t))r.push({c:'party',i:5,n:'同辈互助',p:v5,cf:.45});if(r.length===0)return{c:'?',i:-1,n:'不确定',p:0,cf:0,raw:t};r.sort(function(a,b){return b.cf-a.cf;});var b=r[0];b.raw=t;if(!APP.learnedMap)APP.learnedMap={};return b;}
function caw(t){
  var known=APP.learnedMap&&APP.learnedMap[t.trim()];
  if(known)return JSON.parse(JSON.stringify(known));
  var result=_classifyAwardLegacy(t);if(!result)return result;
  var level=dlv(t);
  if(/奖学金/.test(t)&&!/国家奖学金|国家励志|励志奖学金|一等|二等|三等/.test(t)){result.cf=0.4;result.pts=0;result.p=0;result.reviewReason='奖学金名称或等次不完整，请确认后计分。';return result;}
  var needsLevel=(result.c==='ac'&&(result.i===3||result.i===4))||(result.c==='party'&&result.i===3)||/体育|足球|篮球|排球|羽毛球|乒乓|游泳|田径|长跑|跳远/.test(t);
  if(needsLevel&&!level.known&&!/论文|专利|SCI|EI|软著|软件著作权/.test(t)){
    result.cf=Math.min(result.cf||0,0.4);result.pts=0;result.p=0;
    result.reviewReason='材料未明确获奖阶段，不能仅凭赛事名称确定级别。';
    result.l=level;
  }
  return result;
}
function _classifyAwardLegacy(t){t=t.trim();if(!t)return null;var lm=APP.learnedMap&&APP.learnedMap[t];if(lm)return JSON.parse(JSON.stringify(lm));var l=dlv(t),r=[];if(/论文|专利|期刊|SCI|EI|核心|发表|软著|软件著作权|实用新型|外观设计/.test(t)&&!/奖学金/.test(t)){var cP=R.levelAward['学科竞赛'],ptsP,lvP;if(/SCI|EI|核心|发明专利/.test(t)){ptsP=cP.sc[0];lvP=cP.lv[0];}else if(/实用新型|普通期刊|会议论文/.test(t)){ptsP=cP.sc[1];lvP=cP.lv[1];}else{ptsP=cP.sc[3];lvP=cP.lv[3];}r.push({c:'ac',i:3,n:'学科竞赛',pts:ptsP,l:{n:lvP,k:'ln'},cf:.92});}if(/奖学金/.test(t)){var c2=R.levelAward['奖学金'],pts=c2.sc[c2.sc.length-1],lvN=c2.lv[c2.lv.length-1];if(/国家奖学金/.test(t)&&!/励志/.test(t)){lvN=c2.lv[0];pts=c2.sc[0];}else if(/国家励志|励志奖学金/.test(t)){lvN=c2.lv[1];pts=c2.sc[1];}else if(/一等/.test(t)){lvN=c2.lv[2];pts=c2.sc[2];}else if(/二等/.test(t)){lvN=c2.lv[3];pts=c2.sc[3];}else if(/三等/.test(t)){lvN=c2.lv[4];pts=c2.sc[4];}r.push({c:'ac',i:5,n:'奖学金/荣誉',pts:pts,l:{n:lvN,k:'ln'},cf:.98});}if(/优秀|先进|标兵|十佳|三好|模范|榜样|先锋|杰出|突出|精神文明|之星|星级|最美|先进个人|文明|积极分子|优秀团干|优秀干事|优秀部长|优秀工作者|先进工作者|先进班集体|文明宿舍|荣誉/.test(t)&&!/奖学金|竞赛|大赛|优秀奖|优秀作品奖/.test(t)){var c3=R.levelAward['荣誉称号'],pts2=c3.sc[0],lv2=c3.lv[0];if(/优秀学员|优秀营员|结业/.test(t)){pts2=c3.sc[1];lv2=c3.lv[1];}if(/志愿|服务之星|志愿者/.test(t)){pts2=c3.sc[2];lv2=c3.lv[2];}if(/标兵|十佳|模范|榜样|杰出|突出/.test(t)){pts2=c3.sc[3];lv2=c3.lv[3];}r.push({c:'ac',i:5,n:'奖学金/荣誉',pts:pts2,l:{n:lv2,k:'lp'},cf:.95});}// Sports awards -> 奖学金/荣誉
  if(/体育|篮球|足球|排球|羽毛球|网球|乒乓|游泳|田径|武术|体操|跳绳|毽子|拔河|马拉松|越野|定向|健美操|啦啦操|舞龙|舞狮|龙舟|赛艇|击剑|射击|射箭|举重|摔跤|柔道|跆拳道|拳击|滑冰|滑雪|冰球/.test(t)&&/奖|赛|冠军|亚军|季军|金牌|银牌|铜牌|名次|第一|第二|第三|优胜|锦标赛|杯赛|联赛/.test(t)&&!/志愿/.test(t)){
    var cS=R.levelAward['体育竞赛'];var ptsS=cS?getLvScore('体育竞赛',l.n):(l.n=='国家级'?7:l.n=='省级'?5:l.n=='市级'?3:l.n=='校级/协会级'?2:1);
    r.push({c:'ac',i:5,n:'奖学金/荣誉',pts:ptsS,l:l,cf:.88});}
  if(/竞赛|大赛|挑战杯|建模|蓝桥杯|ACM|数学竞赛|英语竞赛|编程|电子设计|机器人|物理|化学|生物|计算机|外语|翻译|演讲|辩论|知识竞赛|技能赛|三创赛|职业规划大赛/.test(t)&&!/创新|创业|商业|孵化/.test(t)&&!/奖学金/.test(t)&&!/志愿/.test(t)&&!/论文|专利/.test(t)){var c4=R.levelAward['学科竞赛'],pts3=getLvScore('学科竞赛',l.n);r.push({c:'ac',i:3,n:'学科竞赛',pts:pts3||c4.sc[c4.sc.length-1],l:l,cf:.9});}if(/创新|创业|大创|孵化|商业计划|互联网\+|创青春|挑战杯.*创业|立项/.test(t)&&!/奖学金/.test(t)){var c5=R.levelAward['创新创业'],pts4=getLvScore('创新创业',l.n);r.push({c:'ac',i:4,n:'创新创业',pts:pts4||c5.sc[c5.sc.length-1],l:l,cf:.88});}if(/社会实践|三下乡|千股工程|双百行动|红色实践|调研报告|直联|电商助农|直播助农/.test(t)&&!/奖学金|优秀团员/.test(t)){var c6=R.levelAward['社会实践成果'],pts5=getLvScore('社会实践成果',l.n);r.push({c:'party',i:3,n:'社会实践',pts:pts5||c6.sc[c6.sc.length-1],l:l,cf:.85});}if(/志愿/.test(t)&&/奖|星|优秀|先进|表彰|证书|之星/.test(t)&&!/奖学金|竞赛|大赛/.test(t)){r.push({c:'ac',i:5,n:'奖学金/荣誉',pts:2,l:{n:'志愿者之星/优秀志愿者',k:'ls'},cf:.88});}if(/认证|华为|HarmonyOS|高级工程师|高级开发师/.test(t)&&!/奖学金|志愿/.test(t)){var c7=R.levelAward['创新创业'];r.push({c:'ac',i:4,n:'创新创业',pts:c7.sc[c7.sc.length-1],l:l,cf:.72});}if(/证书/.test(t)&&!/荣誉|奖|优秀|志愿服务|志愿|认证|华为|HarmonyOS/.test(t)){var c7b=R.levelAward['创新创业'];r.push({c:'ac',i:4,n:'创新创业',pts:c7b.sc[c7b.sc.length-1],l:l,cf:.55});}if(r.length===0&&/奖|赛|杯/.test(t)){var c9=R.levelAward['学科竞赛'],pts7=getLvScore('学科竞赛',l.n);r.push({c:'ac',i:3,n:'学科竞赛',pts:pts7||c9.sc[c9.sc.length-1],l:l,cf:.45});}if(r.length===0)return{c:'?',i:-1,n:'不确定',pts:0,cf:0,raw:t};r.sort(function(a,b){return b.cf-a.cf;});var b=r[0];b.raw=t;if(!APP.learnedMap)APP.learnedMap={};return b;}
function ssw(ps){
  var best=0,bestIt=null,review=[];
  if(!ps||/^(无|暂无|-)$/.test(String(ps).trim()))return{s:0,it:[],review:[]};
  var entries=String(ps).split(/[,，、;；/\n]+/).map(function(x){return x.replace(/\s+/g,'');}).filter(Boolean);
  entries.forEach(function(raw){
    var school=/校级|学校|校团委|校学生会|校社联|校[^，；;]*?(?:部|会|团|队|社)/.test(raw);
    var college=!school&&/学院|院级|院团委|院学生会|院[^，；;]*?部/.test(raw);
    var deputy=/副主席|副部长|副主任|副负责人/.test(raw);
    var leader=/主席|部长|主任|负责人/.test(raw);
    var staff=/干事|委员/.test(raw);
    var sc=0,level='',badge=school?'ls':college?'ly':'ls';
    if(/副班长/.test(raw)){sc=R.socialWork['副班长'];level='副班长';}
    else if(/班长|团支书|团支部书记/.test(raw)){sc=R.socialWork['班长/团支书'];level='班长/团支书';}
    else if(/主席团成员/.test(raw)){review.push({raw:raw,reason:'主席团成员的计分档位需要管理员确认。'});}
    else if(staff){sc=R.socialWork['其他班委/院级干事/校级干事'];level=school?'校级干事/委员':college?'院级干事/委员':'班委/干事';}
    else if(deputy&&school){sc=R.socialWork['校级副主席/副部长'];level='校级副主席/副部长';}
    else if(deputy&&college){review.push({raw:raw,reason:'现有规则没有单列院级副职，请管理员确认，不自动按正职计分。'});}
    else if(leader&&school){sc=R.socialWork['校级主席/部长'];level='校级主席/部长';}
    else if(leader&&college){sc=R.socialWork['院级主席/部长'];level='院级主席/部门负责人';}
    else if(/班委/.test(raw)){sc=R.socialWork['其他班委/院级干事/校级干事'];level='其他班委';}
    else{review.push({raw:raw,reason:'请写清校级或院级、组织部门和职务；当前信息不足以自动计分。'});}
    if(!Number.isFinite(sc)&&level){review.push({raw:raw,reason:'该职务对应的积分档位尚未配置。'});return;}
    if(sc>best){best=sc;bestIt={r:raw,s:sc,l:level,lk:badge};}
  });
  return{s:best,it:bestIt?[bestIt]:[],review:review};
}

function classifyMember(m){if(m._ok&&m._recognitionVersion===12)return;_captureManualItems(m);m._recognitionVersion=12;m._ok=true;m._cl={ac:[[],[],[],[],[],[]],pt:[[],[],[],[],[],[]],dc:[[],[],[],[],[],[]]};m._unc=[];var done={};function add(k){if(done[k])return true;done[k]=true;return false;}var awards=sp(m['获奖情况']||'');(function(arr){var a2=[];for(var j=0;j<arr.length;j++){var t=arr[j],m=t.match(/^(.*?)(\d{4}[-~—至到]\d{4}\s*\S{0,3})\s*(及|和|与)\s*(\d{4}[-~—至到]\d{4}\s*\S{0,3})\s*(.*)$/);if(m){a2.push((m[1]+m[2]+m[5]).trim());a2.push((m[1]+m[4]+m[5]).trim());}else{a2.push(t);}}arr.length=0;for(var j=0;j<a2.length;j++)arr.push(a2[j]);})(awards);for(var i=0;i<awards.length;i++){var t=awards[i];if(add(t))continue;var cl=caw(t);if(!cl)continue;if(cl.c=='?'){m._unc.push({type:'award',raw:t,cl:cl});continue;}if(cl.cf<.55){m._unc.push({type:'award',raw:t,cl:cl});continue;}if(cl.c=='ac')m._cl.ac[cl.i].push({raw:t,score:cl.pts,level:cl.l?cl.l.n:'',lk:cl.l?cl.l.k:'ls',auto:true});else if(cl.c=='party')m._cl.pt[cl.i].push({raw:t,score:cl.pts||cl.p||0,level:cl.l?cl.l.n:'',lk:cl.l?cl.l.k:'ls',auto:true});}var acts=sp(m['参与学校、学院的活动（请罗列）']||'');for(var i=0;i<acts.length;i++){var t=acts[i];if(add(t))continue;var cl=ca(t);if(!cl)continue;if(cl.sk)continue;if(cl.c=='?'){m._unc.push({type:'activity',raw:t,cl:cl});continue;}if(cl.cf<.55){m._unc.push({type:'activity',raw:t,cl:cl});continue;}if(cl.c=='party')m._cl.pt[cl.i].push({raw:t,score:cl.p,level:'',lk:'ls',auto:true});}var pos=m['职位（班级/部门）']||'';if(pos&&pos!='无'&&pos!='-'&&!add('_pos_')){var sw=ssw(pos);m._cl.ac[2]=sw.it.map(function(x){return{raw:'职务: '+x.r,score:x.s,level:x.l,lk:x.lk,auto:true};});(sw.review||[]).forEach(function(u){m._unc.push({type:'position',raw:'职务: '+u.raw,cl:{c:'ac',i:2,n:'社会工作',cf:0.4,pts:0,reviewReason:u.reason}});});}if(!add('_rank_')){var rc=fc(m,['学习','成绩']);if(rc){var rr=rk(m[rc]);if(rr)m._cl.ac[0].push({raw:'排名 '+rr.r+'/'+rr.t+' (前'+(rr.p*100).toFixed(1)+'%)',score:sr(rr),auto:true});}var rc2=fc(m,['测评','综测']);if(rc2){var rr2=rk(m[rc2]);if(rr2)m._cl.ac[1].push({raw:'排名 '+rr2.r+'/'+rr2.t+' (前'+(rr2.p*100).toFixed(1)+'%)',score:sr(rr2),auto:true});}}if(!add('_volh_')){var vCat=R.levelAward['志愿服务'],vMode=vCat?((vCat.mode)||'level'):'level';if(vMode=='hourly'){var vRate=vCat.rate||0.25,vCap=vCat.cap||8;var vc=fc(m,['志愿','时']);if(vc){var hrs=parseVolHours(m[vc]);if(hrs>0){var rawScore=hrs*vRate;var capped=Math.min(rawScore,vCap);m._cl.pt[1].push({raw:'志愿时长 '+hrs+'h x'+vRate+'='+rawScore.toFixed(1)+(rawScore>vCap?'(上限'+vCap+')':''),score:capped,auto:true});}}}}if(!add('_dc_')){if(m['是否违纪']=='是')m._cl.dc[3].push({raw:'违纪记录',score:R.discipline.warning,auto:true});if(m['是否挂科']=='是')m._cl.dc[1].push({raw:'挂科(每门'+R.discipline.fail+'分)',score:R.discipline.fail,auto:true});}_dedupeExactAwards(m._cl.ac[3]);_dedupeExactAwards(m._cl.pt[3]);_restoreManualItems(m);}
function calc(m,coef){var cl=m._cl,ac=[0,0,0,0,0,0],pt=[0,0,0,0,0,0],dc=[0,0,0,0,0];for(var i=0;i<6;i++){ac[i]=cl.ac[i].reduce(function(s,d){return s+(d.score||0);},0);pt[i]=cl.pt[i].reduce(function(s,d){return s+(d.score||0);},0);if(i<5)dc[i]=cl.dc[i].reduce(function(s,d){return s+(d.score||0);},0);}var cf=coef?0.6:1,fin={ac:[],pt:[],dc:[],t:0,w:[],acT:0,ptT:0,dcT:0};if(dc[1]<0)fin.w.push('存在挂科记录（每门'+R.discipline.fail+'分）');var at=0;for(var i=0;i<6;i++){var v=ac[i]*cf;fin.ac.push(v);at+=v;}if(at>R.acCap){fin.w.push('学业('+at.toFixed(1)+')超上限截断');at=R.acCap;}fin.acT=at;var ptt=0;for(var i=0;i<6;i++){var v=pt[i]*cf;fin.pt.push(v);ptt+=v;}if(ptt>R.ptCap){fin.w.push('党性('+ptt.toFixed(1)+')超上限截断');ptt=R.ptCap;}fin.ptT=ptt;var dt=0;for(var i=0;i<5;i++){var v=dc[i];fin.dc.push(v);dt+=v;}fin.dcT=dt;fin.t=Math.max(0,at+ptt+dt);if(fin.t>100){fin.w.push('总分('+fmt(fin.t)+')超上限截断至100');fin.t=100;}return fin;}
function onBatchCatChange(){var sel=document.getElementById('batchCat');if(!sel||!sel.value)return;var parts=sel.value.split('-'),board=parts[0],si=parseInt(parts[1]);var subName=board=='ac'?AC[si]:(board=='dc'?DS[si]:PS[si]);var lc=getLevelCat(board,si,'');var lvSel=document.getElementById('batchLevel'),scInp=document.getElementById('batchScore');if(lc&&R.levelAward[lc]){lvSel.style.display='';scInp.style.display='none';lvSel.innerHTML='';var lcat=R.levelAward[lc];for(var j=0;j<lcat.lv.length;j++)lvSel.innerHTML+='<option value="'+j+'">'+lcat.lv[j]+' - '+lcat.sc[j]+'分</option>';}else{lvSel.style.display='none';scInp.style.display='';if(board=='pt'&&(si==0||si==2||si==4||si==5))scInp.value=R.perActivity[subName]||2;else scInp.value=0;}}
function onGBatchCatChange(){var sel=document.getElementById('gbatchCat');if(!sel||!sel.value)return;var parts=sel.value.split('-'),board=parts[0],si=parseInt(parts[1]);var subName=board=='ac'?AC[si]:(board=='dc'?DS[si]:PS[si]);var lc=getLevelCat(board,si,'');var lvSel=document.getElementById('gbatchLevel'),scInp=document.getElementById('gbatchScore');if(lc&&R.levelAward[lc]&&R.levelAward[lc].lv){lvSel.style.display='';scInp.style.display='none';lvSel.innerHTML='';var lcat=R.levelAward[lc];for(var j=0;j<lcat.lv.length;j++)lvSel.innerHTML+='<option value="'+j+'">'+lcat.lv[j]+' - '+lcat.sc[j]+'分</option>';}else{lvSel.style.display='none';scInp.style.display='';if(board=='pt'&&(si==0||si==2||si==4||si==5))scInp.value=R.perActivity[subName]||2;else scInp.value=0;}}
function batchFixHandler(){
  if(!APP.members.length)return;var m=APP.members[APP.curIdx];if(!m||!m._unc)return;
  var bv=document.getElementById('batchCat').value;if(!bv)return alert('请先选择目标分类');
  var parts=bv.split('-');var board=parts[0],si=parseInt(parts[1]);
  var cbs=document.querySelectorAll('.unc-cb:checked');if(!cbs.length)return alert('请勾选要归类的项目');
  if(!confirm('确定将 '+cbs.length+' 个项目批量归类？'))return;
  var arr=board=='ac'?m._cl.ac[si]:(board=='pt'?m._cl.pt[si]:m._cl.dc[si]);
  var lc=getLevelCat(board,si,'');
  var defaultScore=0,defaultLevel='',defaultLk='ls';
  if(lc&&R.levelAward[lc]){
    var lvSel=document.getElementById('batchLevel');
    var li=lvSel.value?parseInt(lvSel.value):0;
    defaultScore=R.levelAward[lc].sc[li];defaultLevel=R.levelAward[lc].lv[li];
    if(/国家|全国/.test(defaultLevel))defaultLk='ln';else if(/省/.test(defaultLevel))defaultLk='lp';else if(/市/.test(defaultLevel))defaultLk='lm';else if(/校/.test(defaultLevel))defaultLk='ls';else if(/院/.test(defaultLevel))defaultLk='ly';
  }else{
    defaultScore=parseFloat(document.getElementById('batchScore').value)||0;
  }
  var toRemove=[];
  cbs.forEach(function(cb){
    var idx2=parseInt(cb.getAttribute('data-uidx'));
    var rawText=m._unc[idx2].raw;
    arr.push({raw:rawText,score:defaultScore,level:defaultLevel,lk:defaultLk,auto:false});
    if(!APP.learnedMap)APP.learnedMap={};
    var le={raw:rawText,cf:1};
    if(board=='ac'){le.c='ac';le.i=si;le.n=AC[si];le.pts=defaultScore;le.l={n:defaultLevel||'',k:defaultLk||'ls'};}
    else if(board=='pt'){le.c='party';le.i=si;le.n=PS[si];le.p=defaultScore;}
    else{le.c='dc';le.i=si;le.n=DS[si];le.p=defaultScore;}
    APP.learnedMap[rawText]=le;
    toRemove.push(idx2);
  });
  toRemove.sort(function(a,b){return b-a;});
  toRemove.forEach(function(idx2){m._unc.splice(idx2,1);});
  render();
}
function render(){
  if(!APP.members.length){
    var critOpen=!document.getElementById('panelCriteria').classList.contains('hide');
    if(!critOpen){document.getElementById('viewPersonal').classList.add('hide');document.getElementById('emptyState').classList.remove('hide');renderMemberList();updateUncStats();return;}
    document.getElementById('emptyState').classList.add('hide');document.getElementById('viewPersonal').classList.remove('hide');
    renderMemberList();updateUncStats();renderCriteria();return;
  }
  document.getElementById('emptyState').classList.add('hide');document.getElementById('viewPersonal').classList.remove('hide');
  var i=APP.curIdx;if(i>=APP.members.length)i=0;var m=APP.members[i];if(!m)return;var coef=APP.coef;classifyMember(m);var fin=calc(m,coef);
  document.getElementById('mhName').textContent=m['姓名']||'';document.getElementById('mhClass').textContent=m['班级']||'';document.getElementById('coefCb').checked=coef;
  document.getElementById('cAc').textContent=fmt(fin.acT);document.getElementById('cPt').textContent=fmt(fin.ptT);
  if(coef){var rawAc=0;for(var j=0;j<6;j++)rawAc+=m._cl.ac[j].reduce(function(s,d){return s+(d.score||0);},0);
    var rawPt=0;for(var j=0;j<6;j++)rawPt+=m._cl.pt[j].reduce(function(s,d){return s+(d.score||0);},0);
    var acPre=rawAc*0.6,ptPre=rawPt*0.6;
    var acSub=acPre>fin.acT+0.01?'原始'+fmt(rawAc)+' ×0.6='+fmt(acPre)+' →截断'+R.acCap:'原始'+fmt(rawAc)+' ×0.6';
    var ptSub=ptPre>fin.ptT+0.01?'原始'+fmt(rawPt)+' ×0.6='+fmt(ptPre)+' →截断'+R.ptCap:'原始'+fmt(rawPt)+' ×0.6';
    document.getElementById('cAc').innerHTML=fmt(fin.acT)+'<div style="font-size:10px;color:var(--mut);margin-top:2px">'+acSub+'</div>';
    document.getElementById('cPt').innerHTML=fmt(fin.ptT)+'<div style="font-size:10px;color:var(--mut);margin-top:2px">'+ptSub+'</div>';}document.getElementById('cDc').textContent=fmt(fin.dcT);document.getElementById('cTot').textContent=fmt(fin.t);
  document.getElementById('lblAcCap').textContent=R.acCap;document.getElementById('lblPtCap').textContent=R.ptCap;
  var wb=document.getElementById('warnBox');if(fin.w&&fin.w.length>0){wb.innerHTML=fin.w.join('<br>');wb.classList.add('on');}else{wb.classList.remove('on');wb.innerHTML='';}
  var all18=fin.ac.concat(fin.pt).concat(fin.dc);
  var ht='<thead><tr><th class="ch" colspan="3">基本信息</th><th class="ch" colspan="6" style="background:#3B6FB6">学业能力</th><th class="ch" colspan="6" style="background:#8B1A1A">党性成长</th><th class="ch" colspan="5" style="background:#C07830">纪律约束</th><th class="ch">合计</th></tr>';
  ht+='<tr><th class="sh col-sticky col-sticky-1">序号</th><th class="sh col-sticky col-sticky-2">班级</th><th class="sh col-sticky col-sticky-3">姓名</th>';for(var j=0;j<AC.length;j++)ht+='<th class="sh">'+AC[j]+'</th>';for(var j=0;j<PS.length;j++)ht+='<th class="sh">'+PS[j]+'</th>';for(var j=0;j<DS.length;j++)ht+='<th class="sh">'+DS[j]+'</th>';ht+='<th class="sh">合计</th></tr></thead><tbody><tr>';
  ht+='<td class="col-sticky col-sticky-1">'+(m['序号']||m['编号']||(i+1))+'</td><td class="col-sticky col-sticky-2">'+esc(m['班级']||'')+'</td><td class="col-sticky col-sticky-3">'+esc(m['姓名']||'')+'</td>';
  for(var j=0;j<all18.length;j++){var v=all18[j],cls='sc '+(v===0?'s0':v>0?'sp':'sn');ht+='<td class="'+cls+'" data-ci="'+j+'" style="cursor:pointer" title="点击编辑">'+fmt(v)+'</td>';}
  ht+='<td class="sc" style="font-size:15px;color:#8B1A1A">'+fmt(fin.t)+'</td></tr></tbody>';document.getElementById('scoreTable').innerHTML=ht;
  var cells=document.querySelectorAll('#scoreTable td[data-ci]');for(var j=0;j<cells.length;j++){(function(ci){cells[j].onclick=function(){editSub(ci);};})(parseInt(cells[j].getAttribute('data-ci')));}
  var dg=document.getElementById('detailGrid'),cards='';var al=['学业成绩','综合测评','社会工作','学科竞赛','创新创业','奖学金/荣誉'];
  for(var j=0;j<6;j++){var rs=m._cl.ac[j].reduce(function(s,d){return s+(d.score||0);},0);cards+=buildCard('ac',j,al[j],m._cl.ac[j],rs);}
  for(var j=0;j<6;j++){var rs=m._cl.pt[j].reduce(function(s,d){return s+(d.score||0);},0);cards+=buildCard('pt',j,PS[j],m._cl.pt[j],rs);}
  for(var j=0;j<5;j++){if(!m._cl.dc[j].length)continue;var rs=m._cl.dc[j].reduce(function(s,d){return s+(d.score||0);},0);cards+=buildCard('dc',j,DS[j],m._cl.dc[j],rs);}dg.innerHTML=cards;
  var btns=dg.querySelectorAll('button[data-act]');for(var j=0;j<btns.length;j++){btns[j].onclick=(function(b){var act=b.getAttribute('data-act'),cat=b.getAttribute('data-cat'),si=parseInt(b.getAttribute('data-si')),idx2=parseInt(b.getAttribute('data-idx'));return function(){if(act=='edit')editItem(cat,si,idx2);else if(act=='move')moveItem(cat,si,idx2);else if(act=='del')delItem(cat,si,idx2);else if(act=='add')openAddModal(cat,si);};})(btns[j]);}
  var ul=document.getElementById('uncList');
  if(m._unc&&m._unc.length>0){
    var batchHTML='<div class="batch-bar"><label style="cursor:pointer"><input type="checkbox" id="batchCheckAll" onchange="var c=this.checked;document.querySelectorAll(\'.unc-cb\').forEach(function(cb){cb.checked=c;});"> 全选</label><select id="batchCat" onchange="onBatchCatChange()"><option value="">-- 批量归类到 --</option>';
    for(var i2=0;i2<AC.length;i2++)batchHTML+='<option value="ac-'+i2+'">学业-'+AC[i2]+'</option>';
    for(var i2=0;i2<PS.length;i2++)batchHTML+='<option value="pt-'+i2+'">党性-'+PS[i2]+'</option>';
    for(var i2=0;i2<DS.length;i2++)batchHTML+='<option value="dc-'+i2+'">纪律-'+DS[i2]+'</option>';
    batchHTML+='</select><input type="number" id="batchScore" value="0" step="0.1" style="width:60px"><select id="batchLevel" style="display:none"></select><button class="btn btn-p btn-s" id="btnBatchFix">批量归类</button><span style="flex:1"></span><button class="btn btn-g btn-s" id="btnBatchIgnore">忽略选中</button></div>';
    var groups={};for(var gi=0;gi<m._unc.length;gi++){var gn=m._unc[gi].cl.n||'其他未识别';if(!groups[gn])groups[gn]=[];groups[gn].push({idx:gi,u:m._unc[gi]});}
    var body='';
    for(var gn in groups){
      body+='<div class="unc-group"><div class="unc-group-title">📁 可能属于 <b>'+gn+'</b>（'+groups[gn].length+'项）</div>';
      for(var gj=0;gj<groups[gn].length;gj++){var g=groups[gn][gj],u=g.u;
        body+='<div class="unc-item"><input type="checkbox" class="unc-cb" data-uidx="'+g.idx+'">['+(u.type=='award'?'奖项':u.type=='position'?'职务':'活动')+'] <b>'+esc(u.raw.substring(0,80))+'</b> '+(u.cl.reviewReason?'<span class="review-reason">'+esc(u.cl.reviewReason)+'</span>':'')+' — '+(u.cl.cf?Math.round(u.cl.cf*100)+'%':'')+' <button class="btn btn-p btn-s" data-ufix="'+g.idx+'">归类</button> <button class="btn btn-g btn-s" data-udel="'+g.idx+'">忽略</button></div>';
      }
      body+='</div>';
    }
    ul.innerHTML='<div style="border:1px solid #F0E0C0;border-radius:6px;padding:10px">'+batchHTML+body+'</div>';
    ul.querySelectorAll('[data-ufix]').forEach(function(btn){btn.onclick=function(){quickFix(parseInt(this.getAttribute('data-ufix')));};});
    ul.querySelectorAll('[data-udel]').forEach(function(btn){btn.onclick=function(){var idx2=parseInt(this.getAttribute('data-udel'));m._unc.splice(idx2,1);render();};});
    var bbt=document.getElementById('btnBatchFix');if(bbt)bbt.onclick=batchFixHandler;
    var big=document.getElementById('btnBatchIgnore');if(big)big.onclick=function(){var cbs=document.querySelectorAll('.unc-cb:checked');var tr=[];cbs.forEach(function(cb){tr.push(parseInt(cb.getAttribute('data-uidx')));});tr.sort(function(a,b){return b-a;});tr.forEach(function(idx2){m._unc.splice(idx2,1);});render();};
    document.getElementById('uncBadge').textContent=m._unc.length;document.getElementById('uncBadge').classList.add('on');}
  else{ul.innerHTML='<div style="color:var(--mut);text-align:center;padding:16px">✓ 暂无不确定项</div>';document.getElementById('uncBadge').classList.remove('on');}
  renderMemberList();updateUncStats();if(!document.getElementById('viewSummary').classList.contains('hide'))renderSummaryTable();sv();}
function buildCard(cat,si,name,items,sub){var zero=sub===0,cls=(zero?'zero':'open');var stc=cat=='ac'?'var(--blu)':(cat=='pt'?'#B86868':'var(--org)');if(sub<0)stc='#C0392B';if(sub===0)stc='#CCC';var h='<div class="dcard '+cls+'"><div class="dcard-header" onclick="this.parentElement.classList.toggle(\'open\')"><span class="dcard-arrow">▶</span><span class="dcard-title">'+name+'</span><span class="dcard-subtotal" style="color:'+stc+'">'+fmt(sub)+'分</span></div><div class="dcard-body">';if(!items||!items.length)h+='<div style="color:#CCC;font-size:12px;padding:4px">暂无条目</div>';else for(var j=0;j<items.length;j++){var d=items[j];h+='<div class="dr"><span class="dt" title="'+esc(d.raw)+'">'+esc(d.raw.substring(0,100))+'</span>'+(d.level?'<span class="badge-tag '+(d.lk||'ls')+'">'+d.level+'</span>':'')+'<span class="ds" style="color:'+(d.score>0?'var(--grn)':'#C0392B')+'">'+(d.score>0?'+':'')+fmt(d.score)+'</span><button class="btn btn-s" data-act="edit" data-cat="'+cat+'" data-si="'+si+'" data-idx="'+j+'">✏️</button><button class="btn btn-s" data-act="move" data-cat="'+cat+'" data-si="'+si+'" data-idx="'+j+'">↗移</button><button class="btn btn-d btn-s" data-act="del" data-cat="'+cat+'" data-si="'+si+'" data-idx="'+j+'">×</button></div>';}h+='<div class="dr" style="font-weight:700;background:#FAFAFA"><span class="dt">小计</span><span></span><span class="ds" style="color:'+stc+'">'+fmt(sub)+'</span></div>';h+='<button class="btn btn-s" style="width:100%;margin-top:6px" data-act="add" data-cat="'+cat+'" data-si="'+si+'">+ 添加条目</button></div></div>';return h;}
/* ── 渲染左侧成员列表（含分数配色、悬浮卡片、点击定位汇总行）── */
function renderMemberList(){var ml=document.getElementById('memberList'),h='';for(var i=0;i<APP.members.length;i++){var s=APP.members[i];classifyMember(s);var fin2=calc(s,false);var nm=(s['姓名']||'?');var av=nm.charAt(0);var cls=s['班级']||'';
  // 总分按区间配色：≥75 绿、50-74 默认、<50 红
  var scCls=fin2.t>=75?'high':fin2.t>=50?'mid':'low';
  var uncBadge=(s._unc&&s._unc.length>0)?'<span class="mi-unc" title="'+s._unc.length+' 项待归类">'+s._unc.length+'</span>':'';
  h+='<div class="mitem'+(i===APP.curIdx?' active':'')+'" data-mi="'+i+'" data-act="'+fmt(fin2.acT)+'" data-ptt="'+fmt(fin2.ptT)+'" data-dct="'+fmt(fin2.dcT)+'"><span class="avatar">'+esc(av)+'</span><span class="mi-info"><span class="mi-name">'+esc(s['姓名']||'')+'</span><span class="mi-cls">'+esc(cls)+'</span></span>'+uncBadge+'<span class="mi-score '+scCls+'">'+fmt(fin2.t)+'</span></div>';}ml.innerHTML=h||'<div class="list-empty">暂无成员</div>';document.getElementById('sideCount').textContent=APP.members.length;
  var items=ml.querySelectorAll('.mitem');
  for(var i=0;i<items.length;i++){(function(idx2,el){
    el.onmouseenter=function(e){
      // 每次弹出前先清除页面上所有旧悬浮弹窗，禁止多个堆叠
      closeAllTooltips();
      var ac=el.getAttribute('data-act'),pt=el.getAttribute('data-ptt'),dc=el.getAttribute('data-dct');
      var tip=document.createElement('div');tip.className='member-tooltip';
      tip.innerHTML='<div class="tt-row"><span class="tt-label">学业能力</span><span class="tt-val ac">'+ac+'</span></div><div class="tt-row"><span class="tt-label">党性成长</span><span class="tt-val pt">'+pt+'</span></div><div class="tt-row"><span class="tt-label">纪律约束</span><span class="tt-val dc">'+dc+'</span></div>';
      document.body.appendChild(tip);
      var rect=el.getBoundingClientRect();
      tip.style.left=Math.min(rect.right+10,window.innerWidth-200)+'px';
      tip.style.top=Math.max(rect.top-20,4)+'px';
    };
    // mouseleave 立即关闭所有悬浮卡片
    el.onmouseleave=function(){closeAllTooltips();};
    el.onclick=function(){
      closeAllTooltips();
      APP.curIdx=idx2;render();
      // 若汇总表可见，尝试定位对应行
      setTimeout(function(){scrollToSummaryRow(idx2);},200);
    };
  })(parseInt(items[i].getAttribute('data-mi')),items[i]);}
}
/* ── 清除页面上所有悬浮分数卡片 ── */
function closeAllTooltips(){
  var tips=document.querySelectorAll('.member-tooltip');
  for(var i=0;i<tips.length;i++){tips[i].remove();}
}
/* ── 在汇总表中高亮定位指定成员的行 ── */
function scrollToSummaryRow(mi){
  var tbl=document.getElementById('summaryTable');if(!tbl)return;
  var viewSum=document.getElementById('viewSummary');if(viewSum.classList.contains('hide'))return;
  var rows=tbl.querySelectorAll('tbody tr');
  // 汇总表行顺序与成员列表一致，直接按索引定位
  if(mi<rows.length){
    var row=rows[mi];
    // 移除旧高亮
    tbl.querySelectorAll('.highlight-row').forEach(function(r){r.classList.remove('highlight-row');});
    row.classList.add('highlight-row');
    row.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(function(){row.classList.remove('highlight-row');},2200);
  }
}
function getArr(cat,si){var m=APP.members[APP.curIdx];if(!m||!m._cl)return null;return cat=='ac'?m._cl.ac[si]:cat=='pt'?m._cl.pt[si]:m._cl.dc[si];}
function getLevelCat(cat,si,rawText){if(cat=='ac'&&si==3)return'学科竞赛';if(cat=='ac'&&si==4)return'创新创业';if(cat=='ac'&&si==5){return'__MERGED__';}if(cat=='pt'&&si==1)return'志愿服务';if(cat=='pt'&&si==3)return'社会实践成果';return null;}
function editItem(cat,si,idx2){var arr=getArr(cat,si);if(!arr||!arr[idx2])return;var d=arr[idx2];openItemModal('编辑条目',d,function(raw,score,lvl,lk){d.raw=raw;d.score=score;d.level=lvl;d.lk=lk;d.auto=false;closeModal();render();if(!document.getElementById("viewSummary").classList.contains("hide"))renderSummaryTable();},cat,si);}
function delItem(cat,si,idx2){if(!confirm('确定删除？'))return;var arr=getArr(cat,si);if(!arr)return;arr.splice(idx2,1);render();}function moveItem(cat,si,idx2){var arr=getArr(cat,si);if(!arr||!arr[idx2])return;var d=arr[idx2];var allSubs=AC.concat(PS).concat(DS);var curName=allSubs[cat=='ac'?si:(cat=='pt'?si+6:si+12)];var curBoard=cat=='ac'?'学业':(cat=='pt'?'党性':'纪律');var m2='<h3>移动条目</h3><div style="font-size:13px;color:var(--mut);margin-bottom:8px">当前: '+curBoard+'-'+curName+'</div>';m2+='<div class="fg"><label>移动到</label><select id="mvCat">';for(var i=0;i<AC.length;i++)m2+='<option value="ac-'+i+'">学业-'+AC[i]+'</option>';for(var i=0;i<PS.length;i++)m2+='<option value="pt-'+i+'">党性-'+PS[i]+'</option>';for(var i=0;i<DS.length;i++)m2+='<option value="dc-'+i+'">纪律-'+DS[i]+'</option>';m2+='</select></div><div class="modal-acts"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" id="btnMoveConfirm">确定移动</button></div>';document.getElementById('modalBox').innerHTML=m2;document.getElementById('btnMoveConfirm').onclick=function(){var parts=document.getElementById('mvCat').value.split('-');var newCat=parts[0],newSi=parseInt(parts[1]);if(newCat==cat&&newSi==si){closeModal();return;}var tgt=getArr(newCat,newSi);if(!tgt){closeModal();return;}arr.splice(idx2,1);d.auto=false;tgt.push(d);if(!APP.learnedMap)APP.learnedMap={};var le={raw:d.raw,cf:1};if(newCat=='ac'){le.c='ac';le.i=newSi;le.n=AC[newSi];le.pts=d.score;le.l={n:d.level||'',k:d.lk||'ls'};}else if(newCat=='pt'){le.c='party';le.i=newSi;le.n=PS[newSi];le.p=d.score;}else{le.c='dc';le.i=newSi;le.n=DS[newSi];le.p=d.score;}APP.learnedMap[d.raw]=le;closeModal();render();if(!document.getElementById("viewSummary").classList.contains("hide"))renderSummaryTable();};document.getElementById('modalBg').style.display='flex';}
function openAddModal(cat,si){openItemModal('添加条目',null,function(raw,score,lvl,lk){var arr=getArr(cat,si);if(!arr)return;arr.push({raw:raw,score:score,level:lvl,lk:lk,auto:false});closeModal();render();if(!document.getElementById("viewSummary").classList.contains("hide"))renderSummaryTable();},cat,si);}
function openItemModal(title,d,saveFn,cat,si){var allSubs=AC.concat(PS).concat(DS),colIdx=cat=='ac'?si:(cat=='pt'?si+6:si+12),subName=allSubs[colIdx];var rawText=d?d.raw:'';var levelCat=getLevelCat(cat,si,rawText);var m2='<h3>'+title+' - '+subName+'</h3>';m2+='<div class="fg"><label>描述 *</label><input id="eRaw" value="'+(d?esc(d.raw):'')+'"></div>';if(levelCat=='__MERGED__'){
    var mergeOpts=[];
    var mcats=['奖学金','荣誉称号','体育竞赛','体育赛事获奖'];
    for(var ci=0;ci<mcats.length;ci++){
      var cn=mcats[ci];var lcat2=R.levelAward[cn];if(!lcat2)continue;
      mergeOpts.push({label:'-- '+cn+' --',score:0,disabled:true});
      for(var j=0;j<lcat2.lv.length;j++){mergeOpts.push({label:lcat2.lv[j],score:lcat2.sc[j],cat:cn,idx:j});}
    }
    m2+='<div class="fg"><label>等级</label><select id="eLv">';
    for(var j=0;j<mergeOpts.length;j++){
      var mo=mergeOpts[j];var sel2=d&&d.level==mo.label;
      m2+='<option value="'+j+'"'+(sel2?' selected':'')+(mo.disabled?' disabled style="color:#999;font-weight:bold"':'')+'>'+mo.label+(mo.disabled?'':' - '+mo.score+'分')+'</option>';
    }
    m2+='</select></div><div class="fg"><label>分数</label><input id="eScore" type="number" step="0.1" value="'+(d?d.score:(mergeOpts[1]?mergeOpts[1].score:0))+'"></div>';
    window._mergeOpts=mergeOpts;
  }else if(levelCat&&R.levelAward[levelCat]){var lcat=R.levelAward[levelCat];m2+='<div class="fg"><label>等级</label><select id="eLv">';for(var j=0;j<lcat.lv.length;j++){var sel=d&&d.level==lcat.lv[j];m2+='<option value="'+j+'"'+(sel?' selected':'')+'>'+lcat.lv[j]+' - '+lcat.sc[j]+'分</option>';}m2+='</select></div><div class="fg"><label>分数</label><input id="eScore" type="number" step="0.1" value="'+(d?d.score:lcat.sc[0])+'"></div>';}else if(cat=='pt'&&(si==0||si==2||si==4||si==5)){var perV=R.perActivity[subName]||2;m2+='<div class="fg"><label>分数</label><input id="eScore" type="number" step="0.1" value="'+(d?d.score:perV)+'"></div>';}else{m2+='<div class="fg"><label>分数</label><input id="eScore" type="number" step="0.1" value="'+(d?d.score:0)+'"></div>';}m2+='<div class="fg"><label>等级标签(可选)</label><select id="eLvLabel"><option value="">无</option>';for(var j=0;j<ALL_LV.length;j++){var s2=d&&d.level==ALL_LV[j];m2+='<option'+(s2?' selected':'')+'>'+ALL_LV[j]+'</option>';}m2+='</select></div><div class="modal-acts"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" id="btnSaveItem">💾 保存</button></div>';document.getElementById('modalBox').innerHTML=m2;if(levelCat){var elv2=document.getElementById('eLv');if(elv2)elv2.onchange=function(){var idx3=parseInt(this.value);if(window._mergeOpts){var mo2=window._mergeOpts[idx3];if(mo2&&!mo2.disabled)document.getElementById('eScore').value=mo2.score;}else if(R.levelAward[levelCat]){document.getElementById('eScore').value=R.levelAward[levelCat].sc[idx3];}};}document.getElementById('btnSaveItem').onclick=function(){var raw=document.getElementById('eRaw').value.trim();if(!raw)return alert('请输入描述');var score=parseFloat(document.getElementById('eScore').value)||0;var lvl2=document.getElementById('eLvLabel').value,lk2='ls';if(window._mergeOpts){var elv3=document.getElementById('eLv');if(elv3){var mo3=window._mergeOpts[parseInt(elv3.value)];if(mo3&&!mo3.disabled){lvl2=mo3.label;score=mo3.score;}}}if(/国家|全国/.test(lvl2))lk2='ln';else if(/省/.test(lvl2))lk2='lp';else if(/市/.test(lvl2))lk2='lm';else if(/院/.test(lvl2))lk2='ly';saveFn(raw,score,lvl2,lk2);};document.getElementById('modalBg').style.display='flex';}
function editSub(colIdx){var isA=colIdx<6,isP=colIdx>=6&&colIdx<12,si=isA?colIdx:(isP?colIdx-6:colIdx-12),cat=isA?'ac':(isP?'pt':'dc');var arr=getArr(cat,si);if(!arr)return;var allSubs=AC.concat(PS).concat(DS);var m2='<h3>'+allSubs[colIdx]+'</h3>';if(!arr.length)m2+='<div style="color:var(--mut);margin-bottom:8px">暂无条目</div>';for(var j=0;j<arr.length;j++){var d=arr[j];m2+='<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px;padding:5px 8px;background:#F9F9F9;border-radius:4px;font-size:13px"><span style="flex:1">'+esc(d.raw.substring(0,80))+'</span>'+(d.level?'<span style="font-size:11px;background:#E0E0E0;padding:2px 6px;border-radius:3px">'+esc(d.level)+'</span>':'')+'<input id="es'+j+'" value="'+d.score+'" type="number" step="0.1" style="width:70px;padding:3px;font-size:13px"><button class="btn btn-d btn-s" data-subdel="'+j+'">×</button></div>';}m2+='<div style="display:flex;gap:6px;align-items:center;padding:5px 8px;background:#E8F5E9;border-radius:4px;margin-top:8px"><input id="eNewRaw" placeholder="+ 新增条目" style="flex:1;padding:4px;border:1px solid var(--brd);border-radius:4px;font-size:13px"><input id="eNewScore" value="0" type="number" step="0.1" style="width:70px;padding:4px;font-size:13px"></div>';m2+='<div class="modal-acts"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" id="btnSaveSub">💾 保存</button></div>';document.getElementById('modalBox').innerHTML=m2;var delBtns=document.querySelectorAll('#modalBox [data-subdel]');for(var j=0;j<delBtns.length;j++){(function(idx2){delBtns[j].onclick=function(){if(!confirm('确定删除？'))return;arr.splice(idx2,1);closeModal();editSub(colIdx);};})(parseInt(delBtns[j].getAttribute('data-subdel')));}document.getElementById('btnSaveSub').onclick=function(){for(var j=0;j<arr.length;j++){var inp=document.getElementById('es'+j);if(inp){arr[j].score=parseFloat(inp.value)||0;arr[j].auto=false;}}var nr=document.getElementById('eNewRaw'),ns=document.getElementById('eNewScore');if(nr&&nr.value.trim())arr.push({raw:nr.value.trim(),score:parseFloat(ns.value)||0,level:'',lk:'ls',auto:false});closeModal();render();if(!document.getElementById("viewSummary").classList.contains("hide"))renderSummaryTable();};document.getElementById('modalBg').style.display='flex';}
function quickFix(idx){var m=APP.members[APP.curIdx];if(!m||!m._unc[idx])return;var u=m._unc[idx];var catOpts=[];for(var i=0;i<AC.length;i++)catOpts.push({v:'学业-'+AC[i],board:'ac',si:i});for(var i=0;i<PS.length;i++)catOpts.push({v:'党性-'+PS[i],board:'pt',si:i});for(var i=0;i<DS.length;i++)catOpts.push({v:'纪律-'+DS[i],board:'dc',si:i});var m2='<h3>手动归类</h3><div style="word-break:break-all;margin-bottom:8px;font-size:13px">'+esc(u.raw)+'</div>';m2+='<div class="fg"><label>归类到</label><select id="fCat">';for(var i=0;i<catOpts.length;i++)m2+='<option value="'+i+'">'+catOpts[i].v+'</option>';m2+='</select></div>';m2+='<div class="fg" id="fLvDiv" style="display:none"><label>等级</label><select id="fLv"></select></div>';m2+='<div class="fg"><label>分数</label><input id="fScore" type="number" step="0.1" value="'+(u.cl?u.cl.pts||u.cl.p||0:0)+'"></div>';m2+='<div class="modal-acts"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" id="btnFix">确认</button></div>';document.getElementById('modalBox').innerHTML=m2;function updateFLevel(){var idx2=parseInt(document.getElementById('fCat').value);var opt=catOpts[idx2],board=opt.board,si=opt.si;var lc=getLevelCat(board,si,'');var lvDiv=document.getElementById('fLvDiv'),lvSel=document.getElementById('fLv');if(lc=='__MERGED__'){lvDiv.style.display='block';lvSel.innerHTML='';var mcats=['奖学金','荣誉称号','体育竞赛','体育赛事获奖'];for(var ci=0;ci<mcats.length;ci++){var cn2=mcats[ci];var lcat3=R.levelAward[cn2];if(!lcat3)continue;lvSel.innerHTML+='<option disabled style="color:#999;font-weight:bold">-- '+cn2+' --</option>';for(var j=0;j<lcat3.lv.length;j++){lvSel.innerHTML+='<option value="'+cn2+'|'+j+'">'+lcat3.lv[j]+' - '+lcat3.sc[j]+'分</option>';}}var firstCat=R.levelAward['奖学金'];document.getElementById('fScore').value=firstCat?firstCat.sc[0]:0;lvSel.onchange=function(){var parts=this.value.split('|');var cn3=parts[0],idx4=parseInt(parts[1]);document.getElementById('fScore').value=R.levelAward[cn3].sc[idx4];};return;}if(lc&&R.levelAward[lc]){lvDiv.style.display='block';lvSel.innerHTML='';var lcat=R.levelAward[lc];for(var j=0;j<lcat.lv.length;j++)lvSel.innerHTML+='<option value="'+j+'">'+lcat.lv[j]+' - '+lcat.sc[j]+'分</option>';document.getElementById('fScore').value=lcat.sc[0];lvSel.onchange=function(){var idx3=parseInt(this.value);document.getElementById('fScore').value=lcat.sc[idx3];};}else{lvDiv.style.display='none';}}document.getElementById('fCat').onchange=updateFLevel;updateFLevel();
document.getElementById('fCat').onchange=function(){
  updateFLevel();
  var lvDiv=document.getElementById('fLvDiv');
  if(lvDiv&&lvDiv.style.display!=='none')return;
  var idx2=parseInt(this.value);var opt=catOpts[idx2];var board=opt.board,si=opt.si;
  if(board=='pt'&&(si==0||si==2||si==3||si==4||si==5)){
    var subName=PS[si];document.getElementById('fScore').value=R.perActivity[subName]||2;
  }else{
    document.getElementById('fScore').value=0;
  }
};
  document.getElementById('btnFix').onclick=function(){var idx2=parseInt(document.getElementById('fCat').value);var opt=catOpts[idx2],board=opt.board,si=opt.si,sc=parseFloat(document.getElementById('fScore').value)||0;var lvl='',lk='ls',lc=getLevelCat(board,si,'');if(lc&&R.levelAward[lc]){var li=parseInt(document.getElementById('fLv').value);lvl=R.levelAward[lc].lv[li];lk='ln';sc=R.levelAward[lc].sc[li];}if(/省/.test(lvl))lk='lp';else if(/市/.test(lvl))lk='lm';else if(/校/.test(lvl))lk='ls';else if(/院/.test(lvl))lk='ly';var arr=board=='ac'?m._cl.ac[si]:(board=='pt'?m._cl.pt[si]:m._cl.dc[si]);arr.push({raw:u.raw,score:sc,level:lvl,lk:lk,auto:false});if(!APP.learnedMap)APP.learnedMap={};var le={raw:u.raw,cf:1};if(board=='ac'){le.c='ac';le.i=si;le.n=AC[si];le.pts=sc;le.l={n:lvl||'',k:lk||'ls'};}else if(board=='pt'){le.c='party';le.i=si;le.n=PS[si];le.p=sc;}else{le.c='dc';le.i=si;le.n=DS[si];le.p=sc;}APP.learnedMap[u.raw]=le;m._unc.splice(idx,1);closeModal();render();if(!document.getElementById("viewSummary").classList.contains("hide"))renderSummaryTable();};document.getElementById('modalBg').style.display='flex';}
function closeModal(){document.getElementById('modalBg').style.display='none';}
var _sumSortCol=20,_sumSortDir=-1;
function renderSummaryTable(){
  var simple=APP.summaryMode==='simple';
  var rows=[];
  for(var i=0;i<APP.members.length;i++){var mm=APP.members[i];classifyMember(mm);var fin=calc(mm,false);
    if(simple){rows.push([i+1,mm['班级']||'',mm['姓名']||'',fin.acT,fin.ptT,fin.dcT,fin.t]);}
    else{var all18=fin.ac.concat(fin.pt).concat(fin.dc);rows.push([i+1,mm['班级']||'',mm['姓名']||''].concat(all18).concat([fin.t]));}}
  // 切换模式时自动修正排序列越界，防止 detail→simple 索引超出
  var maxCol=simple?6:20;if(_sumSortCol>maxCol){_sumSortCol=maxCol;_sumSortDir=-1;}
  if(_sumSortCol>=0){rows.sort(function(a,b){var va=a[_sumSortCol]||0,vb=b[_sumSortCol]||0;return (va>vb?1:va<vb?-1:0)*_sumSortDir;});}

  var h='';
  if(simple){
    // ── 简洁总分模式表头（7列平铺，无需分组头）──
    var simpleLabels=['序号','班级','姓名','学业能力','党性成长','纪律约束','综合总分'];
    h+='<thead><tr>';
    for(var j=0;j<simpleLabels.length;j++){
      var arrow='';if(j===_sumSortCol)arrow=' <span class="sort-arrow">'+( _sumSortDir>0?'▲':'▼')+'</span>';
      if(j===0)h+='<th class="ch col-sticky col-sticky-1" onclick="sortSummary('+j+')">'+simpleLabels[j]+arrow+'</th>';
      else if(j===1)h+='<th class="ch col-sticky col-sticky-2" onclick="sortSummary('+j+')">'+simpleLabels[j]+arrow+'</th>';
      else if(j===2)h+='<th class="ch col-sticky col-sticky-3" onclick="sortSummary('+j+')">'+simpleLabels[j]+arrow+'</th>';
      else{
        var bg2=j==3?'var(--blu)':j==4?'var(--red)':j==5?'var(--org)':'var(--gold)';
        h+='<th class="ch" style="background:'+bg2+';cursor:pointer" onclick="sortSummary('+j+')">'+simpleLabels[j]+arrow+'</th>';
      }
    }
    h+='</tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      h+='<tr><td class="col-sticky col-sticky-1">'+r[0]+'</td><td class="col-sticky col-sticky-2">'+esc(r[1])+'</td><td class="col-sticky col-sticky-3">'+esc(r[2])+'</td>';
      h+='<td style="font-weight:700;color:'+(r[3]>0?'var(--grn)':'#CCC')+'">'+fmt(r[3])+'</td>';
      h+='<td style="font-weight:700;color:'+(r[4]>0?'var(--grn)':'#CCC')+'">'+fmt(r[4])+'</td>';
      h+='<td style="font-weight:700;color:'+(r[5]<0?'#C0392B':'var(--grn)')+'">'+fmt(r[5])+'</td>';
      var tc=r[6]>=80?'var(--grn)':r[6]>=60?'var(--org)':'#C0392B';
      h+='<td style="font-size:16px;font-weight:700;color:'+tc+'">'+fmt(r[6])+'</td>';
      h+='</tr>';
    }
  }else{
    // ── 明细模式（原有完整逻辑，原封不动保留）──
    var allLabels=['序号','班级','姓名'].concat(AC).concat(PS).concat(DS).concat(['合计']);
    h+='<thead><tr><th class="ch" colspan="3">基本信息</th><th class="ch" colspan="6" style="background:var(--blu)">学业</th><th class="ch" colspan="6" style="background:var(--red)">党性</th><th class="ch" colspan="5" style="background:var(--org)">纪律</th><th class="ch">合计</th></tr><tr>';
    for(var j=0;j<allLabels.length;j++){
      var arrow='';if(j===_sumSortCol)arrow=' <span class="sort-arrow">'+( _sumSortDir>0?'▲':'▼')+'</span>';
      if(j===0)h+='<th class="ch col-sticky col-sticky-1" onclick="sortSummary('+j+')">'+allLabels[j]+arrow+'</th>';
      else if(j===1)h+='<th class="ch col-sticky col-sticky-2" onclick="sortSummary('+j+')">'+allLabels[j]+arrow+'</th>';
      else if(j===2)h+='<th class="ch col-sticky col-sticky-3" onclick="sortSummary('+j+')">'+allLabels[j]+arrow+'</th>';
      else h+='<th class="sh" onclick="sortSummary('+j+')">'+allLabels[j]+arrow+'</th>';
    }
    h+='</tr></thead><tbody>';
    for(var i=0;i<rows.length;i++){var r=rows[i];
      h+='<tr><td class="col-sticky col-sticky-1">'+r[0]+'</td><td class="col-sticky col-sticky-2">'+esc(r[1])+'</td><td class="col-sticky col-sticky-3">'+esc(r[2])+'</td>';
      for(var j=3;j<r.length;j++){var v=r[j];
        var tc=(v>0?'var(--grn)':v<0?'#C0392B':'#CCC');
        if(j===r.length-1){tc=v>=80?'var(--grn)':v>=60?'var(--org)':'#C0392B';}
        h+='<td style="font-weight:700;color:'+tc+'">'+fmt(v)+'</td>';}
      h+='</tr>';
    }
  }
  h+='</tbody>';
  document.getElementById('summaryTable').innerHTML=h;
  // 简洁模式：移除超宽限制，启用自适应列宽
  var sumTbl=document.getElementById('summaryTable');
  if(simple){sumTbl.classList.add('col-auto');}else{sumTbl.classList.remove('col-auto');}
  sumTbl.style.minWidth=simple?'auto':'1500px';
  // 更新切换按钮高亮状态
  updateModeButtons();
  document.getElementById('btnBackSummary').onclick=function(){document.getElementById('viewSummary').classList.add('hide');document.getElementById('viewPersonal').classList.remove('hide');render();};}
/* ── 更新汇总表视图切换按钮的高亮状态 ── */
  function updateModeButtons(){
    var mode=APP.summaryMode||'detail';
    var bd=document.getElementById('btnModeDetail');
    var bs=document.getElementById('btnModeSimple');
    if(bd)bd.classList.toggle('active',mode==='detail');
    if(bs)bs.classList.toggle('active',mode==='simple');
  }
  function sortSummary(col){if(_sumSortCol===col)_sumSortDir*=-1;else{_sumSortCol=col;_sumSortDir=-1;}
    // 持久化排序状态到 APP（纯 UI 状态，不影响数据结构兼容性）
    APP._sortCol=_sumSortCol;APP._sortDir=_sumSortDir;sv();
    renderSummaryTable();}


function renderCriteria(){
  var h='';for(var cn in R.levelAward){var c=R.levelAward[cn];h+='<div class="crit-card"><h5>'+cn+' <button class="btn btn-d btn-s" onclick="if(confirm(\'删除'+cn+'？\')){delete R.levelAward[\''+cn+'\'];renderCriteria();}">×</button></h5>';
    h+='<select onchange="chgMode(\''+cn+'\',this.value)" style="font-size:10px;margin-bottom:4px"><option value="level"'+(c.mode=='level'?' selected':'')+'>等级制</option><option value="per"'+(c.mode=='per'?' selected':'')+'>按次</option><option value="hourly"'+(c.mode=='hourly'?' selected':'')+'>按时长</option></select>';
    if(c.mode=='level'){h+='<div class="crit-levels">';
      for(var j=0;j<c.lv.length;j++){
        var lk='ls';if(/国家|全国/.test(c.lv[j]))lk='ln';else if(/省/.test(c.lv[j]))lk='lp';else if(/市/.test(c.lv[j]))lk='lm';else if(/院/.test(c.lv[j]))lk='ly';
        h+='<span class="crit-tag '+lk+'">'+c.lv[j]+' <b><input type="number" value="'+c.sc[j]+'" onchange="updLvS(\''+cn+'\','+j+',parseFloat(this.value)||0)"></b><button class="btn btn-d btn-s" style="padding:1px 3px;font-size:9px" onclick="delLvI(\''+cn+'\','+j+')">×</button></span>';
      }
      h+='<button class="btn btn-s" onclick="addLvI(\''+cn+'\')" style="font-size:10px;padding:2px 5px">+</button></div>';}
    else if(c.mode=='per'){h+='<div style="font-size:12px;margin-top:4px">每次 <input type="number" value="'+(c.perVal||2)+'" onchange="R.levelAward[\''+cn+'\'].perVal=parseFloat(this.value)||2" style="width:45px"> 分</div>';}
    else{h+='<div style="font-size:12px;margin-top:4px">/时 <input type="number" value="'+(c.rate||0.5)+'" onchange="R.levelAward[\''+cn+'\'].rate=parseFloat(this.value)||0.5" style="width:45px"> 上限 <input type="number" value="'+(c.cap||10)+'" onchange="R.levelAward[\''+cn+'\'].cap=parseFloat(this.value)||10" style="width:45px"></div>';}h+='</div>';}
  h+='<div style="text-align:center;margin-top:6px"><input id="newCritName" placeholder="新子项名称" style="width:100px;padding:3px;border:1px solid var(--brd);border-radius:3px;font-size:11px"><select id="newCritMode" style="padding:3px;font-size:11px"><option value="level">等级制</option><option value="per">按次</option><option value="hourly">按时长</option></select><button class="btn btn-b btn-s" onclick="addNewCrit()">+</button></div>';
  h+='<div class="crit-card" style="margin-top:6px"><h5>社会工作</h5><table><tr><th>职务</th><th>分</th></tr>';for(var k in R.socialWork)h+='<tr><td>'+k+'</td><td><input type="number" value="'+R.socialWork[k]+'" onchange="R.socialWork[\''+k+'\']=parseFloat(this.value)||0" style="width:45px"></td></tr>';h+='</table></div>';
  h+='<div class="crit-card" style="margin-top:6px"><h5>活动类</h5><table><tr><th>类型</th><th>分/次</th></tr>';for(var k2 in R.perActivity)h+='<tr><td>'+k2+'</td><td><input type="number" value="'+R.perActivity[k2]+'" onchange="R.perActivity[\''+k2+'\']=parseFloat(this.value)||0" style="width:45px"></td></tr>';h+='</table></div>';
  h+='<div class="crit-card" style="margin-top:6px"><h5>其他设置</h5><table><tr><th>项</th><th>值</th></tr>';h+='<tr><td>学业上限</td><td><input type="number" value="'+R.acCap+'" onchange="R.acCap=parseFloat(this.value)||40" style="width:55px"></td></tr>';h+='<tr><td>党性上限</td><td><input type="number" value="'+R.ptCap+'" onchange="R.ptCap=parseFloat(this.value)||60" style="width:55px"></td></tr>';h+='<tr><td>前5%</td><td><input type="number" value="'+R.rank.top5+'" onchange="R.rank.top5=parseFloat(this.value)||0" style="width:55px"></td></tr>';h+='<tr><td>前10%</td><td><input type="number" value="'+R.rank.top10+'" onchange="R.rank.top10=parseFloat(this.value)||0" style="width:55px"></td></tr>';h+='<tr><td>前20%</td><td><input type="number" value="'+R.rank.top20+'" onchange="R.rank.top20=parseFloat(this.value)||0" style="width:55px"></td></tr>';  h+='<tr><td>挂科/门</td><td><input type="number" value="'+R.discipline.fail+'" onchange="R.discipline.fail=parseFloat(this.value)||0" style="width:55px"></td></tr></table></div>';document.getElementById('critPanel').innerHTML=h;var cv=document.getElementById('critVersionLabel');if(cv)cv.textContent='评分标准版本 v'+(APP.criteriaVersion||APP_SCHEMA_VERSION);}
function addNewCrit(){var name=document.getElementById('newCritName').value.trim();if(!name)return alert('请输入名称');if(R.levelAward[name])return alert('已存在');var mode=document.getElementById('newCritMode').value;R.levelAward[name]={lv:['等级1','等级2','等级3'],sc:[3,2,1],mode:mode};if(mode=='per')R.levelAward[name].perVal=2;if(mode=='hourly'){R.levelAward[name].rate=0.5;R.levelAward[name].cap=10;}renderCriteria();}
function chgMode(cn,m){R.levelAward[cn].mode=m;if(m=='per'&&!R.levelAward[cn].perVal)R.levelAward[cn].perVal=2;if(m=='hourly'&&!R.levelAward[cn].rate)R.levelAward[cn].rate=0.5;if(m=='hourly'&&!R.levelAward[cn].cap)R.levelAward[cn].cap=10;renderCriteria();}
function updLvN(cn,i,v){R.levelAward[cn].lv[i]=v;}function updLvS(cn,i,v){R.levelAward[cn].sc[i]=v;}function addLvI(cn){R.levelAward[cn].lv.push('新等级');R.levelAward[cn].sc.push(1);renderCriteria();}function delLvI(cn,i){if(R.levelAward[cn].lv.length<=1)return;R.levelAward[cn].lv.splice(i,1);R.levelAward[cn].sc.splice(i,1);renderCriteria();}
function reclassAll(){for(var i=0;i<APP.members.length;i++){_captureManualItems(APP.members[i]);APP.members[i]._ok=null;APP.members[i]._cl=null;APP.members[i]._unc=null;}}
document.querySelectorAll('#mainTabs .tab').forEach(function(t){t.addEventListener('click',function(){switchMainTab(this.getAttribute('data-tab'));});});
document.getElementById('btnOpenCrit').addEventListener('click',openCriteriaTab);
document.getElementById('globalUncBadge').addEventListener('click',openGlobalUncertain);
document.getElementById('coefCb').addEventListener('change',function(){APP.coef=this.checked;sv();render();});
document.addEventListener('keydown',function(e){if(e.target.tagName=='INPUT'||e.target.tagName=='SELECT'||e.target.tagName=='TEXTAREA')return;if(e.key=='ArrowUp'&&APP.curIdx>0){APP.curIdx--;render();}if(e.key=='ArrowDown'&&APP.curIdx<APP.members.length-1){APP.curIdx++;render();}});
document.getElementById('searchMember').addEventListener('input',function(){var q=this.value.toLowerCase();document.querySelectorAll('.mitem').forEach(function(item){var txt=item.textContent.toLowerCase();item.style.display=(!q||txt.indexOf(q)>=0)?'':'none';});});
var pf=null;
document.getElementById('fileInput').addEventListener('change',function(e){var f=this.files[0];var btn=document.getElementById('btnProcess'),msg=document.getElementById('uploadMsg');if(!f){btn.disabled=true;msg.textContent='';pf=null;return;}pf=f;btn.disabled=false;msg.textContent='已选: '+f.name;msg.style.color='var(--grn)';});
document.getElementById('btnProcess').addEventListener('click',function(){if(pf)AppWorkflow.readImportFile(pf);});
document.getElementById('btnAddMember').addEventListener('click',function(){AppWorkflow.addMember();});
document.getElementById('btnClearAll').addEventListener('click',function(){if(!confirm('确定清空全部 '+APP.members.length+' 人？'))return;APP.members.slice().forEach(function(m){AdminCore.archive(APP,m._memberId);});APP.curIdx=0;svNow();render();});
document.getElementById('btnSaveAll').addEventListener('click',function(){svNow();toast('已保存在本机；云端是否成功请查看顶部保存状态。');});

document.getElementById('btnSaveCrit').addEventListener('click',function(){APP.criteriaVersion=APP_SCHEMA_VERSION;sv();reclassAll();render();renderCriteria();if(!document.getElementById('viewSummary').classList.contains('hide'))renderSummaryTable();document.getElementById('statusBar').textContent='评分标准已保存并重算';toast('评分标准已保存，全员分数已重算');});
document.getElementById('btnReset').addEventListener('click',function(){if(confirm('恢复默认评分标准？')){APP.rules=JSON.parse(JSON.stringify(DEF));R=APP.rules;APP.criteriaVersion=APP_SCHEMA_VERSION;sv();renderCriteria();reclassAll();render();toast('已恢复默认评分标准');}});
/* ── 导出汇总：根据当前视图模式自动切换导出内容 ── */
document.getElementById('btnExport').addEventListener('click',function(){if(!APP.members.length)return alert('暂无');
  var simple=APP.summaryMode==='simple';
  // 视图提示
  var hint=document.getElementById('exportHint');if(hint){hint.textContent=simple?'简洁总分模式 · 可自定义列':'明细模式 · 全部分项';hint.classList.remove('hide');setTimeout(function(){hint.classList.add('hide');},3000);}
  for(var i=0;i<APP.members.length;i++)classifyMember(APP.members[i]);
  if(simple){
    // ── 简洁总分模式：弹窗让用户选择要导出的列 ──
    var cols=['学业能力','党性成长','纪律约束','综合总分'];var checked=[true,true,true,true];
    var m2='<h3>导出简洁总分表</h3><div style="font-size:13px;color:var(--mut);margin-bottom:10px">请选择要导出的列（必选固定列不受影响）</div>';
    m2+='<div style="display:flex;flex-direction:column;gap:6px">';
    for(var ci=0;ci<cols.length;ci++)m2+='<label style="cursor:pointer;font-size:14px"><input type="checkbox" class="exp-cb" data-ci="'+ci+'" checked> '+cols[ci]+'</label>';
    m2+='</div>';
    m2+='<div class="modal-acts"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" id="btnExportSimple">📤 导出</button></div>';
    document.getElementById('modalBox').innerHTML=m2;
    document.getElementById('modalBg').style.display='flex';
    document.getElementById('btnExportSimple').onclick=function(){
      closeModal();
      var cbs=document.querySelectorAll('.exp-cb');var sel=[];
      for(var ci=0;ci<cbs.length;ci++){sel.push(cbs[ci].checked);checked[ci]=cbs[ci].checked;}
      // 至少要选一列
      if(!sel.some(function(x){return x;})){toast('请至少选择一列','err');return;}
      var labels=['序号','班级','姓名'];var subCols=['学业能力','党性成长','纪律约束','综合总分'];
      var rows=[labels.concat(subCols.filter(function(_,i){return sel[i];}))];
      for(var i=0;i<APP.members.length;i++){
        var mm=APP.members[i],fin=calc(mm,false);
        var row=[i+1,mm['班级']||'',mm['姓名']||''];
        var vals=[fin.acT,fin.ptT,fin.dcT,fin.t];
        for(var vi=0;vi<vals.length;vi++){if(sel[vi])row.push(+vals[vi].toFixed(2));}
        rows.push(row);
      }
      var ws2=XLSX.utils.aoa_to_sheet(rows);
      ws2['!cols']=[{wch:6},{wch:20},{wch:12}];
      for(var ci=0;ci<4;ci++){if(sel[ci])ws2['!cols'].push({wch:12});}
      var wb2=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb2,ws2,'积分汇总(总分)');
      XLSX.writeFile(wb2,'积分汇总_总分_'+new Date().toISOString().slice(0,10)+'.xlsx');
      toast('已导出简洁总分表');
    };
  }else{for(var i=0;i<APP.members.length;i++)classifyMember(APP.members[i]);var rows=[['序号','班级','姓名','学业能力','','','','','','党性成长','','','','','','纪律约束','','','','','合计']];rows.push(['','',''].concat(AC).concat(PS).concat(DS).concat(['']));for(var i=0;i<APP.members.length;i++){var mm=APP.members[i],fin=calc(mm,false);var row=[i+1,mm['班级']||'',mm['姓名']||''];for(var j=0;j<fin.ac.length;j++)row.push(+fin.ac[j].toFixed(2));for(var j=0;j<fin.pt.length;j++)row.push(+fin.pt[j].toFixed(2));for(var j=0;j<fin.dc.length;j++)row.push(+fin.dc[j].toFixed(2));row.push(+fin.t.toFixed(2));rows.push(row);}var ws=XLSX.utils.aoa_to_sheet(rows);ws['!merges']=[{s:{r:0,c:0},e:{r:1,c:0}},{s:{r:0,c:1},e:{r:1,c:1}},{s:{r:0,c:2},e:{r:1,c:2}},{s:{r:0,c:3},e:{r:0,c:8}},{s:{r:0,c:9},e:{r:0,c:14}},{s:{r:0,c:15},e:{r:0,c:19}},{s:{r:0,c:20},e:{r:1,c:20}}];var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'积分汇总表');
  // Add criteria sheet
  var critRows=[['类别','模式','等级/项','分值']];
  for(var cn in R.levelAward){var c=R.levelAward[cn];if(c.mode=='level'){for(var j=0;j<c.lv.length;j++)critRows.push([cn,'等级制',c.lv[j],c.sc[j]]);}
  else if(c.mode=='per'){critRows.push([cn,'按次','每次',c.perVal||2]);}
  else{critRows.push([cn,'按时长','/时',c.rate||0.5]);critRows.push([cn,'按时长','上限',c.cap||10]);}}
  critRows.push(['社会工作','-','-','-']);for(var k in R.socialWork)critRows.push(['社会工作','',k,R.socialWork[k]]);
  critRows.push(['活动类','-','-','-']);for(var k2 in R.perActivity)critRows.push(['活动类','',k2,R.perActivity[k2]]);
  critRows.push(['其他','学业上限','',R.acCap]);critRows.push(['其他','党性上限','',R.ptCap]);
  critRows.push(['其他','挂科/门','',R.discipline.fail]);critRows.push(['其他','前5%','',R.rank.top5]);critRows.push(['其他','前10%','',R.rank.top10]);critRows.push(['其他','前20%','',R.rank.top20]);
  var cs=XLSX.utils.aoa_to_sheet(critRows);cs['!cols']=[{wch:18},{wch:10},{wch:20},{wch:8}];XLSX.utils.book_append_sheet(wb,cs,'评分标准');
  XLSX.writeFile(wb,'积分汇总_明细_'+new Date().toISOString().slice(0,10)+'.xlsx');toast('已导出明细汇总表');}});
document.getElementById('btnExportDetail').addEventListener('click',function(){if(!APP.members.length)return;var m=APP.members[APP.curIdx];classifyMember(m);var fin=calc(m,APP.coef);var rows=[[m['姓名']+' - '+m['班级']+' 积分明细']];rows.push(['板块','子项','描述','等级','得分']);var ad=[];for(var j=0;j<6;j++){var items=m._cl.ac[j]||[];for(var k=0;k<items.length;k++)ad.push(['学业能力',AC[j],items[k].raw,items[k].level||'',items[k].score]);}for(var j=0;j<6;j++){var items=m._cl.pt[j]||[];for(var k=0;k<items.length;k++)ad.push(['党性成长',PS[j],items[k].raw,items[k].level||'',items[k].score]);}for(var j=0;j<6;j++){var items=m._cl.dc[j]||[];for(var k=0;k<items.length;k++)ad.push(['纪律约束',DS[j],items[k].raw,items[k].level||'',items[k].score]);}for(var j=0;j<ad.length;j++)rows.push(ad[j]);rows.push(['','','','总分',fin.t]);var ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:12},{wch:16},{wch:60},{wch:16},{wch:10}];var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'个人明细');XLSX.writeFile(wb,(m['姓名']||'成员')+'_积分明细.xlsx');});
document.getElementById('btnBackup').addEventListener('click',function(){_downloadFullBackup();toast('完整备份已下载，包含批次、勾选名单和历史筛选结果。');});
document.getElementById('restoreFile').addEventListener('change',async function(){
  var file=this.files[0];this.value='';if(!file||!confirm('恢复备份将替换当前工作数据（包括批次和筛选名单），不会自动合并。继续？'))return;
  try{var data=JSON.parse((await file.text()).replace(/^\uFEFF/,''));if(!data.rules||!Array.isArray(data.members))throw new Error('不是完整积分备份。');
    _downloadFullBackup('恢复前备份');clearTimeout(_svTimer);_svTimer=null;_applyData(data);_lastSavedPayload=null;svNow();toast('备份已在本机恢复，请确认云端保存成功。');
  }catch(e){toast('恢复失败：'+e.message,'err');}
});
document.getElementById('btnTpl').addEventListener('click',function(){
  var a=document.createElement('a');a.href='assets/information-template-examples.xlsx';a.download='国际交流学院信息收集表_含填写示例.xlsx';document.body.appendChild(a);a.click();a.remove();
});
document.getElementById('btnShowSummary').addEventListener('click',function(){
  document.getElementById('viewPersonal').classList.add('hide');document.getElementById('emptyState').classList.add('hide');
  document.getElementById('viewSummary').classList.remove('hide');renderSummaryTable();
});
document.getElementById('modalBg').addEventListener('click',function(e){if(e.target===this)closeModal();});
// Paste zone click
document.getElementById('pasteZone').addEventListener('click',function(){document.getElementById('statusBar').textContent='请按 Ctrl+V 粘贴表格数据';});
// Paste tables use exactly the same duplicate check and batch preview as Excel.
document.addEventListener('paste',function(e){
  if(/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)||e.target.isContentEditable)return;
  var html=(e.clipboardData||window.clipboardData).getData('text/html');if(!html||html.indexOf('<table')<0)return;
  e.preventDefault();var temp=document.createElement('div');temp.innerHTML=html;
  var table=temp.querySelector('table');if(!table)return;var rows=table.querySelectorAll('tr');if(rows.length<2)return;
  var headers=Array.from(rows[0].querySelectorAll('td,th')).map(function(c){return c.textContent.trim();});
  var data=Array.from(rows).slice(1).map(function(tr){var row={};Array.from(tr.querySelectorAll('td,th')).forEach(function(c,i){if(headers[i]&&headers[i][0]!=='_')row[headers[i]]=c.textContent.trim();});return row;});
  AppWorkflow.previewImport(data,'粘贴表格');
});
// Drag-drop
var dz=document.getElementById('dropZone');
dz.addEventListener('dragover',function(e){e.preventDefault();this.classList.add('dragover');});
dz.addEventListener('dragleave',function(e){this.classList.remove('dragover');});
dz.addEventListener('drop',function(e){e.preventDefault();this.classList.remove('dragover');var f=e.dataTransfer.files[0];if(!f)return;var inp=document.getElementById('fileInput');try{var dt=new DataTransfer();dt.items.add(f);inp.files=dt.files;}catch(e){inp.files=e.dataTransfer.files;}inp.dispatchEvent(new Event('change'));});
/* ── 汇总表视图切换按钮 ── */
  var btnModeDetail=document.getElementById('btnModeDetail');
  var btnModeSimple=document.getElementById('btnModeSimple');
  if(btnModeDetail)btnModeDetail.addEventListener('click',function(){
    if(APP.summaryMode==='detail')return;
    APP.summaryMode='detail';_sumSortCol=20;_sumSortDir=-1;APP._sortCol=_sumSortCol;APP._sortDir=_sumSortDir;sv();
    if(!document.getElementById('viewSummary').classList.contains('hide'))renderSummaryTable();
  });
  if(btnModeSimple)btnModeSimple.addEventListener('click',function(){
    if(APP.summaryMode==='simple')return;
    APP.summaryMode='simple';_sumSortCol=6;_sumSortDir=-1;APP._sortCol=_sumSortCol;APP._sortDir=_sumSortDir;sv();
    if(!document.getElementById('viewSummary').classList.contains('hide'))renderSummaryTable();
  });

  if(typeof XLSX=='undefined'){document.getElementById('statusBar').textContent='XLSX库加载失败！';}else{document.getElementById('statusBar').textContent='系统就绪 v'+APP_SCHEMA_VERSION+(APP.criteriaVersion?' · 标准v'+APP.criteriaVersion:'');}
/* ── 云同步启动 ── */
var _btnLogin=document.getElementById('btnLogin'),_btnLogout=document.getElementById('btnLogout'),_loginPwd=document.getElementById('loginPwd');
if(_btnLogin)_btnLogin.addEventListener('click',tryLogin);
if(_loginPwd)_loginPwd.addEventListener('keydown',function(e){if(e.key==='Enter')tryLogin();});
if(_btnLogout)_btnLogout.addEventListener('click',doLogout);
if(!CLOUD_ENABLED){
  if(_btnLogout)_btnLogout.style.display='none';
  try{renderCriteria();render();updateUncStats();}catch(e){document.getElementById('statusBar').textContent='初始化错误: '+e.message;console.error(e);}
}else{
  try{localStorage.removeItem('pps_ck');}catch(e){}
  document.getElementById('loginBg').classList.add('on');
  _tryAutoLogin();
}
