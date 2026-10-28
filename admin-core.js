(function(root){
  'use strict';
  function clone(x){return JSON.parse(JSON.stringify(x));}
  function ensure(s){if(!Array.isArray(s.recycleBin))s.recycleBin=[];if(!Array.isArray(s.auditLog))s.auditLog=[];}
  function archive(s,mid){
    ensure(s);var i=s.members.findIndex(function(m){return m._memberId===mid;});if(i<0)throw Error('未找到该同学。');
    var m=s.members[i];
    s.recycleBin.push({id:BatchCore.id('deleted'),deletedAt:new Date().toISOString(),member:clone(m)});
    s.members.splice(i,1);BatchCore.ensure(s);s.curIdx=Math.max(0,Math.min(s.curIdx||0,s.members.length-1));
  }
  function restore(s,id){
    ensure(s);var i=s.recycleBin.findIndex(function(r){return r.id===id;});if(i<0)throw Error('回收记录不存在。');
    var m=s.recycleBin[i].member,sid=BatchCore.studentId(m);
    if(s.members.some(function(x){return x._memberId===m._memberId||(sid&&BatchCore.studentId(x)===sid)||((!sid||!BatchCore.studentId(x))&&BatchCore.text(x['姓名'])===BatchCore.text(m['姓名'])&&BatchCore.text(x['班级'])===BatchCore.text(m['班级']));}))throw Error('人员库中已有相同标识、学号或同名同班人员，请先核对，未自动覆盖。');
    var restored=clone(m);restored._ok=null;s.members.push(restored);s.recycleBin.splice(i,1);BatchCore.ensure(s);
  }
  function purge(s,id){ensure(s);var i=s.recycleBin.findIndex(function(r){return r.id===id;});if(i<0)throw Error('回收记录不存在。');s.recycleBin.splice(i,1);}
  function person(m){
    var out={};Object.keys(m).sort().forEach(function(k){if(k[0]!=='_')out[k]=m[k];});
    out['人工计分']=clone(m._manualItems||[]);return out;
  }
  function snapshot(s){ensure(s);return {members:s.members.map(function(m){return{id:m._memberId,data:person(m)};}),bin:s.recycleBin.map(function(r){return{id:r.id,mid:r.member._memberId,name:r.member['姓名']};}),rules:clone(s.rules)};}
  function changes(before,after){var keys=Array.from(new Set(Object.keys(before).concat(Object.keys(after))));return keys.filter(function(k){return JSON.stringify(before[k])!==JSON.stringify(after[k]);}).map(function(k){return{field:k,before:before[k]==null?'':before[k],after:after[k]==null?'':after[k]};});}
  function record(s,previous){
    ensure(s);var next=snapshot(s);if(!previous)return next;
    function add(action,mid,name,diff){s.auditLog.push({id:BatchCore.id('audit'),at:new Date().toISOString(),actor:'管理员（共用账号）',action:action,memberId:mid||'',name:name||'',changes:diff||[]});}
    next.members.forEach(function(m){var old=previous.members.find(function(x){return x.id===m.id;});if(!old){add(previous.bin.some(function(r){return r.mid===m.id;})?'恢复人员':'新增人员',m.id,m.data['姓名'],changes({},m.data));}else{var diff=changes(old.data,m.data);if(diff.length)add('修改资料或积分',m.id,m.data['姓名'],diff);}});
    previous.members.forEach(function(m){if(!next.members.some(function(x){return x.id===m.id;}))add(next.bin.some(function(r){return r.mid===m.id;})?'移入回收站':'移除人员',m.id,m.data['姓名'],[]);});
    previous.bin.forEach(function(r){if(!next.bin.some(function(x){return x.id===r.id;})&&!next.members.some(function(m){return m.id===r.mid;}))add('永久删除人员',r.mid,r.name,[]);});
    var diff=changes(previous.rules,next.rules);if(diff.length)add('修改评分规则','','',diff);
    if(s.auditLog.length>500)s.auditLog=s.auditLog.slice(-500);
    return next;
  }
  root.AdminCore={ensure:ensure,archive:archive,restore:restore,purge:purge,snapshot:snapshot,record:record};
})(typeof window!=='undefined'?window:globalThis);
