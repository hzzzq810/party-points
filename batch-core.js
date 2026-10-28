(function(root,factory){
  var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BatchCore=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  var AWARDS='获奖情况',ACTIVITIES='参与学校、学院的活动（请罗列）';
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function text(value){return value==null?'':String(value).normalize('NFKC').trim();}
  function id(prefix){return prefix+'_'+(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));}
  function studentId(m){return text(m['学号']);}
  function manualItems(m){
    if(!m._cl)return clone(m._manualItems||[]);
    var items=[];['ac','pt','dc'].forEach(function(cat){(m._cl[cat]||[]).forEach(function(arr,si){arr.forEach(function(item){if(item.auto===false)items.push({cat:cat,si:si,item:clone(item)});});});});return items;
  }
  function ensure(state){
    if(!state||!Array.isArray(state.members))throw new Error('人员数据格式不正确。');
    if(!Array.isArray(state.batches))state.batches=[];
    if(!Array.isArray(state.screeningHistory))state.screeningHistory=[];
    if(!state.screeningDraft||!Array.isArray(state.screeningDraft.selectedIds))state.screeningDraft={name:'',period:'',selectedIds:[]};
    var ids=new Set(),batchIds=new Set(state.batches.map(function(b){return b.id;}));
    state.members.forEach(function(m){
      if(!m._memberId||ids.has(m._memberId))m._memberId=id('person');ids.add(m._memberId);
      if(!Array.isArray(m._batchIds)||!m._batchIds.length)m._batchIds=['legacy'];
      m._batchIds=Array.from(new Set(m._batchIds));
      m._batchIds.forEach(function(b){if(!batchIds.has(b)){state.batches.push({id:b,name:b==='legacy'?'历史已录入人员':'原有批次',createdAt:null});batchIds.add(b);}});
    });
    state.screeningDraft.selectedIds=Array.from(new Set(state.screeningDraft.selectedIds.filter(function(mid){return ids.has(mid);})));state.workflowVersion=1;return state;
  }
  function normalizeRow(row){
    var clean={};Object.keys(row).forEach(function(key){var k=text(key).replace(/\r?\n/g,'');if(!k||k[0]==='_'||['__proto__','constructor','prototype'].indexOf(k)>=0)return;clean[k]=row[key];});
    clean['姓名']=text(clean['姓名']||clean['名字']);clean['班级']=text(clean['班级']||clean['班别']);
    if(clean['学号']!=null&&clean['学号']!=='')clean['学号']=text(clean['学号']);
    delete clean['名字'];delete clean['班别'];return clean;
  }
  function signature(state){return JSON.stringify(state.members.map(function(m){var c={};Object.keys(m).sort().forEach(function(k){if(k[0]!=='_'||['_memberId','_batchIds','_updatedAt'].indexOf(k)>=0)c[k]=m[k];});c.manual=manualItems(m);return c;}));}
  function mergeLines(oldText,newText){
    var lines=[],seen=new Set();[oldText,newText].forEach(function(v){String(v||'').split(/[\r\n；;]+/).forEach(function(line){line=line.trim();if(!line||/^(无|暂无|-)$/.test(line))return;var key=text(line).replace(/\s+/g,'');if(!seen.has(key)){seen.add(key);lines.push(line);}});});return lines.length?lines.join('\n'):(text(newText)||text(oldText));
  }
  function mergeMember(old,row){
    var m=clone(old);m._manualItems=manualItems(old);
    Object.keys(row).forEach(function(k){if(k[0]==='_'||k==='序号'||k==='编号'||row[k]==null||text(row[k])==='')return;if(k===AWARDS||k===ACTIVITIES)m[k]=mergeLines(m[k],row[k]);else m[k]=typeof row[k]==='string'?row[k].trim():row[k];});
    m._ok=null;m._cl=null;m._unc=null;return m;
  }
  function differences(old,row){var m=mergeMember(old,row),diff=[];Object.keys(row).forEach(function(k){if(k[0]==='_'||k==='序号'||k==='编号')return;if(text(old[k])!==text(m[k]))diff.push({field:k,before:old[k]==null?'':old[k],after:m[k]});});return diff;}
  function planImport(state,rows){
    ensure(state);var bySid=new Map(),byNameClass=new Map(),byName=new Map(),incomingSid=new Map(),incomingName=new Map();
    function add(map,key,value){if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(value);}
    state.members.forEach(function(m){add(bySid,studentId(m),m);add(byName,text(m['姓名']),m);add(byNameClass,text(m['姓名'])+'\u0000'+text(m['班级']),m);});
    var normalized=rows.map(normalizeRow),entries=[];
    normalized.forEach(function(r,i){if(r['姓名']===text('张三（填写示例，请删除或替换）'))return;add(incomingSid,studentId(r),i);add(incomingName,r['姓名']+'\u0000'+r['班级'],i);});
    normalized.forEach(function(r,i){
      if(r['姓名']===text('张三（填写示例，请删除或替换）'))return;
      if(!r['姓名']&&!r['班级']&&!studentId(r))return;
      var e={row:typeof rows[i].__rowNum__==='number'?rows[i].__rowNum__+1:i+2,data:r,status:'new',reason:'新增人员',targetId:null,changes:[]};
      function conflict(reason){e.status='conflict';e.reason=reason;entries.push(e);}
      if(!r['姓名']||!r['班级']){conflict('缺少姓名或班级，请补齐后重新导入。');return;}
      var sid=studentId(r),pair=r['姓名']+'\u0000'+r['班级'];
      var originalSid=rows[i]['学号'];
      if(typeof originalSid==='number'&&!Number.isSafeInteger(originalSid)){conflict('学号被Excel转成了不安全数字，请将学号设为文本后核对。');return;}
      if(sid&&/[eE][+-]?\d+$/.test(sid)){conflict('学号显示为科学计数法，请核对原始学号。');return;}
      if((sid&&incomingSid.get(sid).length>1)||incomingName.get(pair).length>1){conflict('本次表格存在重复学号或同名同班记录，请先核对。');return;}
      var exact=sid?bySid.get(sid)||[]:[],fallback=byNameClass.get(pair)||[],target=null;
      if(exact.length>1){conflict('已有人员中该学号不唯一，请先核对。');return;}
      if(exact.length===1){target=exact[0];if(text(target['姓名'])!==r['姓名']){conflict('学号已存在，但姓名不同，请核对身份。');return;}e.reason='学号匹配已有人员';}
      else if(fallback.length>1){conflict('姓名和班级匹配到多个人员，无法安全合并。');return;}
      else if(fallback.length===1){target=fallback[0];if(sid&&studentId(target)&&sid!==studentId(target)){conflict('同名同班人员已有另一个学号，请核对。');return;}e.reason='仅按姓名＋班级匹配，请核对身份';}
      if(!target&&(byName.get(r['姓名'])||[]).some(function(m){return !sid||!studentId(m);})){conflict('已有同名不同班人员，且缺少可核对的学号，请先核对身份。');return;}
      if(target){e.targetId=target._memberId;e.changes=differences(target,r);e.status=e.changes.length?'update':'unchanged';if(!e.changes.length)e.reason+='；材料未变化';}
      entries.push(e);
    });
    return{entries:entries,baseSignature:signature(state),counts:entries.reduce(function(c,e){c[e.status]++;return c;},{new:0,update:0,unchanged:0,conflict:0})};
  }
  function applyImport(state,plan,options){
    ensure(state);if(signature(state)!==plan.baseSignature)throw new Error('预览期间人员资料已变化，请重新预览后导入。');
    var usable=plan.entries.filter(function(e){return e.status!=='conflict';});if(!usable.length)throw new Error('没有可导入的有效记录。');
    if(plan.counts.conflict&&!options.skipConflicts)throw new Error('存在冲突，请明确确认跳过后再导入。');
    var batch,now=options.now||new Date().toISOString();
    if(options.batchId){batch=state.batches.find(function(b){return b.id===options.batchId;});if(!batch)throw new Error('所选批次不存在。');}
    else{var name=text(options.batchName);if(!name)throw new Error('请填写批次名称。');if(state.batches.some(function(b){return text(b.name)===name;}))throw new Error('已有同名批次，请选择已有批次或修改名称。');batch={id:id('batch'),name:name,createdAt:now};}
    var next=clone(state.members),imported=[];
    usable.forEach(function(e){
      var index=e.targetId?next.findIndex(function(m){return m._memberId===e.targetId;}):-1,m;
      if(e.targetId&&index<0)throw new Error('待更新人员已经不存在，请重新预览。');
      if(index>=0){m=mergeMember(next[index],e.data);next[index]=m;}
      else{m=clone(e.data);m._memberId=id('person');m._batchIds=[];m._ok=null;m._cl=null;m._unc=null;next.push(m);}
      m._batchIds=Array.from(new Set((m._batchIds||[]).concat(batch.id)));m._updatedAt=now;imported.push(m._memberId);
    });
    if(!options.batchId)state.batches.push(batch);state.members=next;
    state.screeningDraft.selectedIds=Array.from(new Set(imported));state.screeningDraft.name=batch.name+'汇总筛选';state.screeningDraft.period=options.period||'';
    return{batch:batch,memberIds:state.screeningDraft.selectedIds.slice(),counts:clone(plan.counts)};
  }
  function batchNames(state,m){return(m._batchIds||[]).map(function(bid){var b=state.batches.find(function(b){return b.id===bid;});return b?b.name:'未知批次';}).join('、');}
  function rankRows(rows){
    rows.sort(function(a,b){return b.total-a.total||a.name.localeCompare(b.name,'zh-CN')||a.memberId.localeCompare(b.memberId);});
    var last=null,rank=0,eligible=0;rows.forEach(function(r){eligible++;if(last!==r.total)rank=eligible;r.rank=rank;last=r.total;});return rows;
  }
  function scoreRows(state,score){
    ensure(state);return rankRows(state.members.map(function(m){var v=score(m);return{memberId:m._memberId,studentId:studentId(m),name:text(m['姓名']),className:text(m['班级']),batchIds:m._batchIds.slice(),batches:batchNames(state,m),updatedAt:m._updatedAt||null,acT:v.acT,ptT:v.ptT,dcT:v.dcT,total:v.t,uncertain:(m._unc||[]).length};}));
  }
  function selectedRows(state,rows){var selected=new Set(state.screeningDraft.selectedIds);return rankRows(clone(rows.filter(function(r){return selected.has(r.memberId);})));}
  function saveScreening(state,rows,options){
    ensure(state);var chosen=selectedRows(state,rows);if(!chosen.length)throw new Error('请先勾选本次参与筛选的人员。');
    if(!text(options.name)||!text(options.period))throw new Error('请填写筛选名称和统一统计口径。');
    if(chosen.some(function(r){return r.uncertain>0;})&&!options.allowPending)throw new Error('名单仍有待审核项，请确认保存为待审核结果。');
    var snapshot={id:id('screening'),name:text(options.name),period:text(options.period),createdAt:options.now||new Date().toISOString(),rows:chosen,rules:clone(state.rules),criteriaVersion:state.criteriaVersion||state.schemaVersion,coefficient:1,status:chosen.some(function(r){return r.uncertain>0;})?'待审核':'已留存'};
    state.screeningHistory.push(snapshot);state.screeningDraft.name=snapshot.name;state.screeningDraft.period=snapshot.period;return snapshot;
  }
  return{ensure:ensure,text:text,id:id,studentId:studentId,planImport:planImport,applyImport:applyImport,mergeLines:mergeLines,signature:signature,batchNames:batchNames,scoreRows:scoreRows,selectedRows:selectedRows,saveScreening:saveScreening,clone:clone,rankRows:rankRows};
});
