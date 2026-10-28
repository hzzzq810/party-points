(function(){
  'use strict';
  var C=window.BatchCore,visible=false,historyId=null,previewPlan=null,importSource='',searchTimer,importReceipt=null;
  var filters={q:'',batch:'',review:'',min:'',max:'',selectedOnly:false};
  function byId(id){return document.getElementById(id);}
  function safe(value){return esc(value==null?'':String(value));}
  function ensure(){C.ensure(APP);}
  function date(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'历史数据，时间未知';}
  function scores(){return C.scoreRows(APP,function(m){classifyMember(m);return calc(m,false);});}
  function persist(){sv();}
  function option(value,label,chosen){return '<option value="'+safe(value)+'"'+(value===chosen?' selected':'')+'>'+safe(label)+'</option>';}
  function options(chosen,all){return(all?option('','全部批次',chosen):'')+APP.batches.map(function(b){return option(b.id,b.name,chosen);}).join('');}
  function openDialog(title,body,actions){
    byId('workflowDialogTitle').textContent=title;byId('workflowDialogBody').innerHTML=body;byId('workflowDialogActions').innerHTML=actions||'';
    byId('workflowDialog').classList.remove('hide');byId('workflowDialogClose').focus();
  }
  function closeDialog(){byId('workflowDialog').classList.add('hide');previewPlan=null;}
  function open(){
    ensure();visible=true;historyId=null;
    ['viewPersonal','viewSummary','emptyState'].forEach(function(id){byId(id).classList.add('hide');});
    byId('workflowView').classList.remove('hide');byId('btnExport').textContent='导出本次勾选名单';render();
  }
  function close(){visible=false;byId('workflowView').classList.add('hide');byId('btnExport').textContent='导出全部汇总';window.render();}
  function selectionSummary(rows){var chosen=C.selectedRows(APP,rows);return '已选 '+chosen.length+' 人 · 待审核 '+chosen.filter(function(r){return r.uncertain>0;}).length+' 人';}
  function passes(row){
    var q=filters.q.toLowerCase();return(!q||(row.name+' '+row.className+' '+row.studentId).toLowerCase().indexOf(q)>=0)&&(!filters.batch||row.batchIds.indexOf(filters.batch)>=0)&&(!filters.review||(filters.review==='pending'?row.uncertain>0:row.uncertain===0))&&(!filters.selectedOnly||APP.screeningDraft.selectedIds.indexOf(row.memberId)>=0)&&(filters.min===''||row.total>=Number(filters.min))&&(filters.max===''||row.total<=Number(filters.max));
  }
  function table(rows,selection){
    var chosen=new Set(APP.screeningDraft.selectedIds);
    return '<div class="workflow-table-wrap"><table class="workflow-table"><thead><tr>'+(selection?'<th>参与</th>':'')+'<th>名次</th><th>姓名／学号</th><th>班级</th><th>批次来源</th><th>学业</th><th>党性</th><th>纪律</th><th>总分</th><th>审核</th><th>资料更新时间</th>'+(selection?'<th>操作</th>':'')+'</tr></thead><tbody>'+rows.map(function(r){
      return '<tr>'+(selection?'<td><input type="checkbox" aria-label="选择'+safe(r.name)+'" data-pick="'+safe(r.memberId)+'"'+(chosen.has(r.memberId)?' checked':'')+'></td>':'')+'<td>'+(r.rank==null?'—':r.rank)+'</td><td><strong>'+safe(r.name)+'</strong><small>'+safe(r.studentId||'未补学号')+'</small></td><td>'+safe(r.className)+'</td><td>'+safe(r.batches)+'</td><td>'+fmt(r.acT)+'</td><td>'+fmt(r.ptT)+'</td><td>'+fmt(r.dcT)+'</td><td class="workflow-total">'+fmt(r.total)+'</td><td>'+ (r.uncertain?'<span class="workflow-warning">待审核 '+r.uncertain+' 项</span>':'无待审核项')+'</td><td>'+safe(date(r.updatedAt))+'</td>'+(selection?'<td><button class="btn btn-s" data-identity="'+safe(r.memberId)+'">补学号</button><button class="btn btn-s" data-detail="'+safe(r.memberId)+'">明细</button></td>':'')+'</tr>';
    }).join('')+'</tbody></table>'+(rows.length?'':'<p class="workflow-empty">当前条件下没有人员。可切换批次或清除筛选条件。</p>')+'</div>';
  }
  function importReceiptHtml(){
    if(!importReceipt)return '';
    var ids=new Set(importReceipt.memberIds),affected=scores().filter(function(r){return ids.has(r.memberId);});
    var items=affected.reduce(function(n,r){return n+r.uncertain;},0),people=affected.filter(function(r){return r.uncertain>0;}).length,c=importReceipt.counts;
    return '<section class="import-receipt" aria-label="最近一次导入结果"><h3>导入完成 · '+safe(importReceipt.batch.name)+'</h3><p>新增 <strong>'+c.new+'</strong> 人，更新 <strong>'+c.update+'</strong> 人，无变化 '+c.unchanged+' 人，跳过冲突 '+c.conflict+' 行。</p><p>本次导入人员当前有 <strong>'+items+'</strong> 项待审核，涉及 '+people+' 人。已自动勾选本次人员，可继续添加老同学。</p><p class="import-receipt-note">资料已处理；云端是否保存成功，请以顶部保存状态为准。历史筛选结果仍需主动保存。</p><div class="workflow-actions"><button class="btn btn-p" data-import-next="review">核对本次待审核材料</button><button class="btn" data-import-next="members">查看导入人员</button><button class="btn" data-import-next="screening">继续选人筛选</button><button class="btn btn-g" data-import-next="dismiss">收起提示</button></div></section>';
  }
  function render(){
    if(!visible)return;ensure();
    var rows=scores(),chosen=C.selectedRows(APP,rows),chosenById=new Map(chosen.map(function(r){return[r.memberId,r];}));
    var body=byId('workflowView');
    body.innerHTML=importReceiptHtml()+'<div class="workflow-heading"><div><h2>批次与汇总筛选</h2><p>先选新批次，再勾选需要一起比较的老同学。评分标准沿用现有配置。</p></div><button class="btn btn-g" data-workflow="back">返回个人视图</button></div>'+
      '<div class="workflow-batch-strip">'+APP.batches.map(function(b){var count=APP.members.filter(function(m){return m._batchIds.indexOf(b.id)>=0;}).length;return '<button class="workflow-batch '+(filters.batch===b.id?'active':'')+'" data-batch-filter="'+safe(b.id)+'"><strong>'+safe(b.name)+'</strong><span>'+count+' 人</span></button>';}).join('')+'<button class="btn" data-workflow="create-batch">＋新建批次</button></div>'+
      '<div class="workflow-filters"><label>搜索<input id="workflowSearch" type="search" value="'+safe(filters.q)+'" placeholder="姓名、班级或学号"></label><label>批次<select id="workflowBatch">'+options(filters.batch,true)+'</select></label><label>审核状态<select id="workflowReview">'+option('','全部',filters.review)+option('pending','仅待审核',filters.review)+option('ready','无待审核项',filters.review)+'</select></label><label>最低分<input id="workflowMin" type="number" min="0" max="100" step="0.1" value="'+safe(filters.min)+'"></label><label>最高分<input id="workflowMax" type="number" min="0" max="100" step="0.1" value="'+safe(filters.max)+'"></label><label class="workflow-check"><input id="workflowSelectedOnly" type="checkbox"'+(filters.selectedOnly?' checked':'')+'>仅看已选</label><button class="btn btn-g" data-workflow="reset-filters">清除条件</button></div>'+
      '<div class="workflow-actions"><button class="btn" data-workflow="select-visible">选中当前筛选人员</button><button class="btn" data-workflow="unselect-visible">取消当前筛选人员</button><button class="btn btn-b" data-workflow="show-selection">查看完整勾选名单</button><button class="btn btn-d" data-workflow="clear-selection">清空本次勾选</button><span id="workflowSelectionSummary">'+selectionSummary(rows)+'</span></div>'+
      '<p class="workflow-note">统一按当前评分标准、原始分数比较（不乘前期0.6系数）。名单里的名次仅针对已选人员；有待审核项的分数为暂计分。</p>'+
      '<div id="workflowRoster">'+table(rows.filter(passes).map(function(r){var copy=C.clone(r);copy.rank=chosenById.has(r.memberId)?chosenById.get(r.memberId).rank:'—';return copy;}),true)+'</div>'+
      '<section class="workflow-save"><h3>保存本次筛选结果</h3><p class="workflow-save-explanation"><strong>此处需要主动保存：</strong>勾选名单会自动保存；要将本次名单、分数和评分依据留作历史结果，请填写下方信息并点击“保存筛选结果”。点击后仍需等待顶部显示“已保存到云端”。</p><div class="workflow-save-fields"><label>筛选名称<input id="screeningName" maxlength="80" value="'+safe(APP.screeningDraft.name||'')+'" placeholder="例如：2026年第二批汇总筛选"></label><label>统一统计口径<input id="screeningPeriod" maxlength="160" value="'+safe(APP.screeningDraft.period||'')+'" placeholder="填写学院要求的材料统计起止时间／累计口径"></label></div><p>请先核对新旧同学材料适用同一统计口径。保存时留存人员、分数、审核状态和评分规则，历史结果不会随以后修改而变化。</p><div class="workflow-actions"><button class="btn btn-p" data-workflow="save-screening">保存筛选结果</button><button class="btn btn-b" data-workflow="export-current">导出本次勾选名单</button></div></section>'+
      '<section class="workflow-history"><h3>已留存的筛选结果</h3>'+(APP.screeningHistory.length?APP.screeningHistory.slice().reverse().map(function(s){return '<div class="workflow-history-row"><div><strong>'+safe(s.name)+'</strong><small>'+safe(date(s.createdAt))+' · '+s.rows.length+' 人 · '+safe(s.status)+' · '+safe(s.period)+'</small></div><button class="btn btn-s" data-history-view="'+safe(s.id)+'">查看</button><button class="btn btn-s" data-history-export="'+safe(s.id)+'">导出</button><button class="btn btn-s" data-history-select="'+safe(s.id)+'">沿用选人名单</button></div>';}).join(''):'<p>尚未保存筛选结果。</p>')+'</section>';
    body.querySelectorAll('[data-import-next]').forEach(function(btn){btn.onclick=function(){
      var page=btn.dataset.importNext;
      if(page==='dismiss'){importReceipt=null;render();return;}
      if(page==='screening'){filters.batch='';filters.q='';filters.review='';filters.min='';filters.max='';filters.selectedOnly=false;render();return;}
      var ids=new Set(importReceipt.memberIds),rows=scores().filter(function(r){return ids.has(r.memberId)&&(page!=='review'||r.uncertain>0);});
      if(!rows.length){toast('本次导入人员暂无待审核材料。');return;}
      APP.curIdx=APP.members.findIndex(function(m){return m._memberId===rows[0].memberId;});
      if(window.AdminWorkspace)window.AdminWorkspace.navigate('members');else close();
      if(page==='review')switchMainTab('uncertain');
    };});
    body.querySelectorAll('[data-workflow]').forEach(function(btn){btn.onclick=function(){action(btn.dataset.workflow);};});
    body.querySelectorAll('[data-batch-filter]').forEach(function(btn){btn.onclick=function(){filters.batch=btn.dataset.batchFilter;render();};});
    body.querySelectorAll('[data-pick]').forEach(function(cb){cb.onchange=function(){var set=new Set(APP.screeningDraft.selectedIds);if(cb.checked)set.add(cb.dataset.pick);else set.delete(cb.dataset.pick);APP.screeningDraft.selectedIds=Array.from(set);persist();render();};});
    body.querySelectorAll('[data-identity]').forEach(function(btn){btn.onclick=function(){identity(btn.dataset.identity);};});
    body.querySelectorAll('[data-detail]').forEach(function(btn){btn.onclick=function(){APP.curIdx=APP.members.findIndex(function(m){return m._memberId===btn.dataset.detail;});if(window.AdminWorkspace)window.AdminWorkspace.navigate('members');else close();};});
    body.querySelectorAll('[data-history-view]').forEach(function(btn){btn.onclick=function(){viewHistory(btn.dataset.historyView);};});
    body.querySelectorAll('[data-history-export]').forEach(function(btn){btn.onclick=function(){exportSnapshot(APP.screeningHistory.find(function(s){return s.id===btn.dataset.historyExport;}));};});
    body.querySelectorAll('[data-history-select]').forEach(function(btn){btn.onclick=function(){reuseHistory(btn.dataset.historySelect);};});
    byId('workflowSearch').oninput=function(){filters.q=this.value;clearTimeout(searchTimer);searchTimer=setTimeout(function(){var pos=byId('workflowSearch').selectionStart;render();byId('workflowSearch').focus();byId('workflowSearch').setSelectionRange(pos,pos);},220);};
    [['workflowBatch','batch'],['workflowReview','review'],['workflowMin','min'],['workflowMax','max']].forEach(function(pair){byId(pair[0]).onchange=function(){filters[pair[1]]=this.value;render();};});
    byId('workflowSelectedOnly').onchange=function(){filters.selectedOnly=this.checked;render();};
    byId('screeningName').oninput=function(){APP.screeningDraft.name=this.value;persist();};byId('screeningPeriod').oninput=function(){APP.screeningDraft.period=this.value;persist();};
  }
  function action(name){
    if(name==='back'){if(window.AdminWorkspace)window.AdminWorkspace.navigate('members');else close();return;}
    if(name==='create-batch'){createBatch();return;}
    if(name==='show-selection'){filters={q:'',batch:'',review:'',min:'',max:'',selectedOnly:true};render();return;}
    if(name==='reset-filters'){filters={q:'',batch:'',review:'',min:'',max:'',selectedOnly:false};render();return;}
    if(name==='save-screening'){saveScreening();return;}
    if(name==='export-current'){exportCurrent();return;}
    var set=new Set(APP.screeningDraft.selectedIds);
    if(name==='clear-selection'){if(!confirm('只清空本次勾选，不删除任何人员资料。继续？'))return;set.clear();}
    else scores().filter(passes).forEach(function(r){if(name==='select-visible')set.add(r.memberId);else set.delete(r.memberId);});
    APP.screeningDraft.selectedIds=Array.from(set);persist();render();
  }
  function createBatch(){
    openDialog('新建录入批次','<label class="workflow-field">批次名称<input id="newBatchName" maxlength="60" placeholder="例如：2026年第二批"></label><p>这里只建立批次，不清空原有人员。导入时选择该批次即可。</p>','<button class="btn btn-p" id="confirmNewBatch">创建</button>');
    byId('confirmNewBatch').onclick=function(){var name=C.text(byId('newBatchName').value);if(!name)return alert('请输入批次名称。');if(APP.batches.some(function(b){return C.text(b.name)===name;}))return alert('已有同名批次。');APP.batches.push({id:C.id('batch'),name:name,createdAt:new Date().toISOString()});persist();closeDialog();render();};
  }
  function identity(mid){
    var m=APP.members.find(function(x){return x._memberId===mid;});if(!m)return;
    openDialog('补充学号','<p>'+safe(m['姓名'])+' · '+safe(m['班级'])+'</p><label class="workflow-field">学号（按证件核对，可保留前导0）<input id="identityStudentId" type="text" value="'+safe(m['学号']||'')+'"></label><p>补学号不修改积分。若学号已被其他人员使用，将停止保存。</p>','<button class="btn btn-p" id="saveIdentity">保存学号</button>');
    byId('saveIdentity').onclick=function(){var sid=C.text(byId('identityStudentId').value);if(sid&&APP.members.some(function(x){return x._memberId!==mid&&C.studentId(x)===sid;}))return alert('该学号已存在，不能重复。');m['学号']=sid;m._updatedAt=new Date().toISOString();persist();closeDialog();render();};
  }
  function previewImport(rows,source){
    if(CLOUD_ENABLED&&!_cloudKey){toast('请先登录管理员账号。','err');return;}
    ensure();APP.members.forEach(_captureManualItems);previewPlan=C.planImport(APP,rows);importSource=source||'手动录入';
    var p=previewPlan,c=p.counts;
    if(!p.entries.length){toast('没有可导入的学生数据；已跳过空行和模板示例。','err');return;}
    openDialog('导入前核对','<p class="workflow-note">'+safe(importSource)+'：新增 '+c.new+' 人，更新 '+c.update+' 人，无变化 '+c.unchanged+' 人，身份冲突 '+c.conflict+' 行。只追加或更新，不清空历史人员。</p>'+
      '<div class="workflow-import-settings"><label>归入批次<select id="importBatch">'+option('','＋新建批次','')+options('',false)+'</select></label><label id="importBatchNameWrap">新批次名称<input id="importBatchName" maxlength="60" placeholder="例如：2026年第二批"></label></div>'+
      '<div class="workflow-table-wrap"><table class="workflow-table"><thead><tr><th>原表行</th><th>姓名／学号</th><th>班级</th><th>处理</th><th>核对事项／变化</th></tr></thead><tbody>'+p.entries.map(function(e){return '<tr><td>'+e.row+'</td><td>'+safe(e.data['姓名'])+'<small>'+safe(e.data['学号']||'未填学号')+'</small></td><td>'+safe(e.data['班级'])+'</td><td>'+({new:'新增',update:'更新',unchanged:'材料无变化',conflict:'暂不导入'})[e.status]+'</td><td>'+safe(e.reason)+(e.changes.length?'<details><summary>查看 '+e.changes.length+' 处变化</summary>'+e.changes.map(function(d){return '<p><b>'+safe(d.field)+'</b><br>原：'+safe(d.before)+'<br>新：'+safe(d.after)+'</p>';}).join('')+'</details>':'')+'</td></tr>';}).join('')+'</tbody></table></div>'+
      (c.conflict?'<label class="workflow-check"><input id="skipImportConflicts" type="checkbox">我确认跳过 '+c.conflict+' 行身份冲突，只导入已核对的人员；冲突行需要修改原表后重新导入。</label>':'')+
      '<p>奖项与活动按完整条目追加去重；其他非空资料按预览更新。请特别核对排名、时长、是否挂科等变化。</p>',
      '<button class="btn btn-g" id="cancelWorkflowImport">取消</button><button class="btn btn-p" id="commitWorkflowImport"'+(c.new+c.update+c.unchanged?'':' disabled')+'>确认导入并选中本批人员</button>');
    // openDialog does not mutate the import plan; cancellation never writes data.
    byId('importBatch').onchange=function(){byId('importBatchNameWrap').classList.toggle('hide',!!this.value);};
    byId('cancelWorkflowImport').onclick=closeDialog;
    byId('commitWorkflowImport').onclick=function(){
      try{if(_cloudConflict)throw new Error('云端存在新版本，请先处理保存冲突。');var result=C.applyImport(APP,previewPlan,{batchId:byId('importBatch').value,batchName:byId('importBatchName').value,skipConflicts:!!(byId('skipImportConflicts')&&byId('skipImportConflicts').checked)});
        importReceipt=result;closeDialog();filters.batch=result.batch.id;filters.q='';filters.selectedOnly=false;_writeLocal();svNow();open();if(window.AdminWorkspace)window.AdminWorkspace.navigate('screening');toast('导入完成。新批次已选中，可切到历史批次继续勾选老同学。');
      }catch(e){alert(e.message);}
    };
  }
  async function readImportFile(file){
    setProcessLoading(true);
    try{var bytes=await file.arrayBuffer(),wb=XLSX.read(new Uint8Array(bytes),{type:'array'}),sheet=wb.Sheets[wb.SheetNames[0]];
      // Read identifiers as displayed text, preserving explicit text/zero-padding.
      var rows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});previewImport(rows,file.name);
    }catch(e){toast('读取失败：'+e.message,'err');}finally{setProcessLoading(false);}
  }
  function addMember(){
    var fields=['姓名','班级','学号','职位（班级/部门）','学习成绩排名','综测排名','志愿总时长','是否旷课','是否违纪','是否挂科','参与学校、学院的活动（请罗列）','获奖情况'];
    openDialog('手动录入人员（下一步核对批次）','<div class="workflow-save-fields">'+fields.map(function(f,i){return '<label>'+safe(f)+(i<2?' *':'')+(i>=10?'<textarea id="manualField'+i+'" rows="3"></textarea>':'<input id="manualField'+i+'" type="text">')+'</label>';}).join('')+'</div>','<button class="btn btn-p" id="previewManualMember">下一步：预览导入</button>');
    byId('previewManualMember').onclick=function(){var row={};fields.forEach(function(f,i){row[f]=byId('manualField'+i).value;});previewImport([row],'手动录入');};
  }
  function saveScreening(){
    try{var rows=scores(),chosen=C.selectedRows(APP,rows),pending=chosen.filter(function(r){return r.uncertain>0;}).length;
      if(!APP.screeningDraft.name.trim()||!APP.screeningDraft.period.trim())throw new Error('请先填写筛选名称和统一统计口径。');
      if(pending&&!confirm('已选人员中有 '+pending+' 人仍存在待审核项。本次将保存为“待审核”结果，不作为最终审核结论。继续？'))return;
      var snap=C.saveScreening(APP,rows,{name:APP.screeningDraft.name,period:APP.screeningDraft.period,allowPending:true});persist();render();toast('已留存 '+snap.rows.length+' 人的筛选结果，等待云端保存状态确认。');
    }catch(e){alert(e.message);}
  }
  function viewHistory(id){
    var s=APP.screeningHistory.find(function(x){return x.id===id;});if(!s)return;historyId=id;
    openDialog(s.name,'<p>'+safe(date(s.createdAt))+' · '+safe(s.period)+' · '+safe(s.status)+'</p><p class="workflow-note">这是当时留存的结果，不会随现有人员资料或规则改变。系数：'+s.coefficient+'；评分版本：'+safe(s.criteriaVersion)+'</p>'+table(s.rows,false),'<button class="btn btn-p" id="exportOpenHistory">导出这次结果</button>');
    byId('exportOpenHistory').onclick=function(){exportSnapshot(s);};
  }
  function reuseHistory(id){
    var s=APP.screeningHistory.find(function(x){return x.id===id;});if(!s||!confirm('沿用当时选人名单，覆盖当前勾选。当前分数将按最新资料重算，原历史结果不变。继续？'))return;
    var ids=new Set(APP.members.map(function(m){return m._memberId;}));APP.screeningDraft.selectedIds=s.rows.map(function(r){return r.memberId;}).filter(function(mid){return ids.has(mid);});APP.screeningDraft.name=s.name+'（重新核对）';APP.screeningDraft.period=s.period;persist();render();if(window.AdminWorkspace)window.AdminWorkspace.navigate('screening');
  }
  function exportCurrent(){
    ensure();var rows=C.selectedRows(APP,scores());if(!rows.length){toast('请先勾选参加本次筛选的同学。','err');return;}
    exportSnapshot({name:APP.screeningDraft.name||'当前勾选名单',period:APP.screeningDraft.period||'尚未填写统一统计口径',createdAt:new Date().toISOString(),rows:rows,rules:APP.rules,criteriaVersion:APP.criteriaVersion,coefficient:1,status:'当前暂计结果'});
  }
  function exportSnapshot(s){
    if(!s)return;var rows=[['名次','学号','姓名','班级','批次来源','学业能力','党性成长','纪律约束','总分','待审核项数','审核状态','资料更新时间','筛选名称','统一统计口径','结果留存时间']];
    s.rows.forEach(function(r){rows.push([r.rank==null?'不参与排名':r.rank,r.studentId,r.name,r.className,r.batches,r.acT,r.ptT,r.dcT,r.total,r.uncertain,r.uncertain?'待审核':'无待审核项',date(r.updatedAt),s.name,s.period,date(s.createdAt)]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[8,18,14,24,30,12,12,12,12,14,16,24,28,40,24].map(function(n){return{wch:n};});
    var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'本次筛选结果');
    var rules=[['规则路径','留存值'],['评分版本',s.criteriaVersion],['本次计分系数',s.coefficient],['结果状态',s.status]];
    function flatten(v,path){if(v&&typeof v==='object')Object.keys(v).forEach(function(k){flatten(v[k],path?path+'.'+k:k);});else rules.push([path,v]);}flatten(s.rules,'评分标准');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rules),'评分依据');XLSX.writeFile(wb,(s.name||'筛选结果').replace(/[\\/:*?"<>|]/g,'_')+'.xlsx');
  }
  byId('btnWorkflow').onclick=open;byId('workflowDialogClose').onclick=closeDialog;
  byId('workflowDialog').addEventListener('click',function(e){if(e.target===this)closeDialog();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!byId('workflowDialog').classList.contains('hide'))closeDialog();});
  byId('btnExport').addEventListener('click',function(e){if(visible){e.stopImmediatePropagation();exportCurrent();}},true);
  var originalRender=window.render;window.render=function(){originalRender();ensure();if(visible){['viewPersonal','viewSummary','emptyState'].forEach(function(id){byId(id).classList.add('hide');});render();}};
  // Preserve access to the original personal renderer: this module's render is scoped.
  var originalApply=window._applyData;window._applyData=function(data){C.ensure(data);originalApply(data);};
  window.AppWorkflow={open:open,close:close,render:render,previewImport:previewImport,readImportFile:readImportFile,addMember:addMember,isOpen:function(){return visible;},closeDialog:closeDialog};
  ensure();
})();
