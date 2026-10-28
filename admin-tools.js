(function(){
  'use strict';
  function el(id){return document.getElementById(id);}
  function safe(x){return esc(x==null?'':String(x));}
  function date(x){return new Date(x).toLocaleString('zh-CN',{hour12:false});}
  ['workspaceRecycle','workspaceAudit'].forEach(function(id){el('mainContent').appendChild(el(id));});
  function canWrite(){if(_cloudConflict){toast('请先处理云端保存冲突，再继续修改。','err');return false;}return true;}
  function recycle(){
    AdminCore.ensure(APP);
    el('workspaceRecycle').innerHTML='<div class="workspace-page-title"><h2>人员回收站</h2><p>移除的人员暂存于此，不参与当前排名；恢复不会自动加入本次勾选名单。已留存的历史结果保持不变。</p></div>'+(APP.recycleBin.length?'<div class="admin-record-list">'+APP.recycleBin.slice().reverse().map(function(r){var m=r.member;return '<article><div><strong>'+safe(m['姓名'])+'</strong><p>'+safe(m['班级'])+' · 学号 '+safe(m['学号']||'未填')+'</p><small>移除时间：'+safe(date(r.deletedAt))+'</small></div><div class="workflow-actions"><button class="btn btn-p" data-restore-person="'+safe(r.id)+'">恢复该同学</button><button class="btn btn-d" data-purge-person="'+safe(r.id)+'">永久删除</button></div></article>';}).join('')+'</div>':'<div class="workspace-help"><h3>回收站为空</h3><p>在“人员与积分”移除的同学会出现在这里，可单独恢复。</p></div>');
    el('workspaceRecycle').querySelectorAll('[data-restore-person]').forEach(function(b){b.onclick=function(){if(!canWrite())return;try{AdminCore.restore(APP,b.dataset.restorePerson);svNow();recycle();toast('已恢复该同学，请按需重新勾选参加筛选，并确认云端保存状态。');}catch(e){toast(e.message,'err');}};});
    el('workspaceRecycle').querySelectorAll('[data-purge-person]').forEach(function(b){b.onclick=function(){if(!canWrite())return;if(!confirm('永久删除后无法从回收站恢复。继续前将下载完整备份，历史筛选结果不受影响。确定继续？'))return;_downloadFullBackup('永久删除前备份');AdminCore.purge(APP,b.dataset.purgePerson);svNow();recycle();toast('已永久删除，请确认云端保存状态。');};});
  }
  function printable(x,field){if(field==='人工计分'&&Array.isArray(x))return x.length?x.map(function(r){var names=r.cat==='ac'?AC:r.cat==='pt'?PS:DS,item=r.item||{};return (names[r.si]||'计分项目')+'：'+(item.raw||'')+' · '+item.score+' 分'+(item.level?' · '+item.level:'');}).join('\n'):'无人工计分';return typeof x==='object'?JSON.stringify(x,null,2):String(x==null?'':x);}
  function audit(){
    _writeLocal();
    el('workspaceAudit').innerHTML='<div class="workspace-page-title"><h2>关键修改记录</h2><p>记录启用后的人员增删、资料、人工计分和规则变化，保留最近 500 条。共用账号统一记为“管理员”，无法区分具体操作人。记录随数据同步，并非不可篡改的审计凭证。</p></div>'+(APP.auditLog.length?'<div class="admin-record-list">'+APP.auditLog.slice().reverse().map(function(r){return '<article><div><strong>'+safe(r.action)+(r.name?' · '+safe(r.name):'')+'</strong><p>'+safe(date(r.at))+' · '+safe(r.actor)+'</p>'+(r.changes.length?'<details><summary>查看 '+r.changes.length+' 项变化</summary>'+r.changes.map(function(d){return '<div class="admin-change"><b>'+safe(d.field)+'</b><div><span>修改前</span><pre>'+safe(printable(d.before,d.field))+'</pre><span>修改后</span><pre>'+safe(printable(d.after,d.field))+'</pre></div></div>';}).join('')+'</details>':'<small>人员操作已记录；误删请到人员回收站恢复。</small>')+'</div></article>';}).join('')+'</div>':'<div class="workspace-help"><h3>暂无修改记录</h3><p>之后修改人员资料、积分或移除人员时，记录会显示在这里。</p></div>');
  }
  var queue=null,committing=false;
  var originalClose=window.closeModal;
  window.closeModal=function(){originalClose();if(!committing)queue=null;};
  function next(){
    if(!queue)return;
    while(queue.cursor<queue.items.length){
      var item=queue.items[queue.cursor],mi=APP.members.findIndex(function(m){return m._memberId===item.mid;});
      if(mi<0){queue.cursor++;continue;}
      var m=APP.members[mi];classifyMember(m);var ui=m._unc.findIndex(function(u){return u.raw===item.raw;});
      if(ui<0){queue.cursor++;continue;}
      APP.curIdx=mi;AdminWorkspace.navigate('members');switchMainTab('uncertain');quickFix(ui);
      var bar=document.createElement('div');bar.className='continuous-review-bar';
      bar.innerHTML='<strong>连续审核 · '+safe(m['姓名'])+' · '+safe(m['班级'])+'</strong><p>第 '+(queue.cursor+1)+' / '+queue.items.length+' 项 · 本次已确认 '+queue.done+' 项 · 跳过 '+queue.skipped+' 项</p><div class="workflow-actions"><button type="button" class="btn" id="reviewSkip">暂时跳过</button><button type="button" class="btn btn-g" id="reviewStop">结束连续审核</button></div>';
      el('modalBox').insertBefore(bar,el('modalBox').firstChild);
      el('reviewSkip').onclick=function(){queue.skipped++;queue.cursor++;next();};
      el('reviewStop').onclick=function(){closeModal();AdminWorkspace.navigate('review');};
      var confirm=el('btnFix'),save=confirm.onclick;confirm.textContent='确认并继续下一项';
      confirm.onclick=function(){
        if(!canWrite())return;
        committing=true;try{save();svNow();queue.done++;queue.cursor++;}finally{committing=false;}
        next();
      };return;
    }
    var done=queue.done,skipped=queue.skipped;queue=null;originalClose();AdminWorkspace.navigate('review');toast('本轮审核结束：确认 '+done+' 项，跳过 '+skipped+' 项。跳过内容仍保留待审核。');
  }
  function startReview(){
    if(!canWrite())return;
    var items=[];APP.members.forEach(function(m){classifyMember(m);m._unc.forEach(function(u){items.push({mid:m._memberId,raw:u.raw});});});
    if(!items.length){toast('目前没有待审核材料。');return;}
    queue={items:items,cursor:0,done:0,skipped:0};next();
  }
  window.AdminTools={recycle:recycle,audit:audit,startReview:startReview};
})();
