(function(){
  'use strict';
  var C=window.BatchCore,current='dashboard',routing=false,peopleQuery='',peopleClass='';
  var initialNavToggle=document.getElementById('workspaceNavToggle');
  var pages={dashboard:'工作台',import:'资料导入',members:'人员与积分',screening:'批次与筛选',review:'待审核材料',summary:'全部积分汇总',history:'历史筛选结果',criteria:'评分标准',backup:'备份与恢复',recycle:'人员回收站',audit:'修改记录'};
  var panelIds=['workspaceDashboard','workspaceImport','workspaceMembers','workspaceReview','workspaceCriteria','workspaceBackup','workspaceRecycle','workspaceAudit','workflowView','viewSummary'];
  function el(id){return document.getElementById(id);}
  function safe(v){return esc(v==null?'':String(v));}
  function pending(){return APP.members.map(function(m,i){classifyMember(m);return{member:m,index:i,count:(m._unc||[]).length};}).filter(function(r){return r.count>0;});}
  function bindRoutes(scope){scope.querySelectorAll('[data-workspace]').forEach(function(b){b.onclick=function(){navigate(b.dataset.workspace);};});}
  // Move existing controls rather than copying them, so their import and editing handlers stay intact.
  el('workspaceImportHost').appendChild(el('uploadSection'));
  el('workspacePeopleHost').appendChild(el('memberSection'));
  el('workspacePersonHost').appendChild(el('viewPersonal'));
  el('workspaceCriteriaHost').appendChild(el('panelCriteria'));
  var navIcons={recycle:'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 10v7 M14 10v7',audit:'M5 3h14v18H5z M8 7h8 M8 12h8 M8 17h5',dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',import:'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',members:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4',screening:'M3 4h18l-7 8v7l-4 2v-9z',review:'M9 3h6v4H9z M9 5H5v16h14V5h-4 M8 14l3 3 5-6',summary:'M4 3v18h17 M8 17v-5 M13 17V7 M18 17V4',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',criteria:'M4 5h16 M4 12h16 M4 19h16 M8 3v4 M16 10v4 M10 17v4',backup:'M4 4h13l3 3v13H4z M8 4v6h8V4 M8 20v-6h8v6'};
  function navButton(key){return '<button type="button" class="workspace-nav-item" data-workspace="'+key+'" title="'+safe(pages[key])+'" aria-label="'+safe(pages[key])+'"><svg class="workspace-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+navIcons[key]+'"></path></svg><span class="workspace-nav-text">'+safe(pages[key])+'</span><span class="workspace-nav-arrow" aria-hidden="true">›</span></button>';}
  el('workspaceSidebar').innerHTML='<div class="workspace-nav-brand"><span class="workspace-nav-kicker">国际交流学院</span><strong>党员发展积分管理</strong><small>管理员工作台</small></div><nav aria-label="系统板块"><div class="workspace-nav-label">日常管理</div>'+['dashboard','import','members','screening','review'].map(navButton).join('')+'<div class="workspace-nav-label">结果与设置</div>'+['summary','history','recycle','audit','criteria','backup'].map(navButton).join('')+'</nav><div class="workspace-nav-foot">录入资料 → 核对材料 → 勾选筛选 → 留存结果</div>';
  bindRoutes(el('workspaceSidebar'));bindRoutes(el('workspaceMembers'));
  // A shared fixed tooltip avoids native title delays and sidebar clipping.
  var navTip=document.createElement('div');navTip.className='workspace-nav-tooltip hide';
  navTip.id='workspaceNavTooltip';navTip.setAttribute('role','tooltip');document.body.appendChild(navTip);
  function hideNavTip(){navTip.classList.add('hide');}
  el('workspaceSidebar').querySelectorAll('[data-workspace]').forEach(function(button){
    button.removeAttribute('title');
    function showNavTip(){
      if(!document.body.classList.contains('workspace-nav-collapsed'))return;
      var rect=button.getBoundingClientRect();navTip.textContent=pages[button.dataset.workspace];
      navTip.style.left=(rect.right+12)+'px';navTip.style.top=rect.top+'px';navTip.classList.remove('hide');
      button.setAttribute('aria-describedby','workspaceNavTooltip');
    }
    button.onmouseenter=showNavTip;button.onmouseleave=hideNavTip;
    button.onfocus=showNavTip;button.onblur=hideNavTip;
    button.addEventListener('click',hideNavTip);
  });
  el('workspaceSidebar').addEventListener('scroll',hideNavTip);
  window.addEventListener('resize',hideNavTip);

  // Layout preferences stay on this computer, separate from shared student data.
  var layoutPrefs={};
  try{layoutPrefs=JSON.parse(localStorage.getItem('pps_layout_preferences')||'{}')||{};}catch(e){}
  if(typeof layoutPrefs!=='object'||Array.isArray(layoutPrefs))layoutPrefs={};
  var navToggle=initialNavToggle,peopleToggle=el('workspacePeopleToggle');
  navToggle.type=peopleToggle.type='button';
  navToggle.className='btn workspace-collapse-nav';peopleToggle.className='btn workspace-collapse-people';
  navToggle.setAttribute('aria-controls','workspaceSidebar');peopleToggle.setAttribute('aria-controls','workspacePeopleHost');
  el('workspaceSidebar').insertBefore(navToggle,el('workspaceSidebar').firstChild);
  el('workspacePersonHost').appendChild(peopleToggle);
  function applyLayoutPrefs(){
    hideNavTip();
    var nav=layoutPrefs.navCollapsed===true,people=layoutPrefs.peopleCollapsed===true;
    document.body.classList.toggle('workspace-nav-collapsed',nav);
    el('workspaceMembers').classList.toggle('people-list-collapsed',people);
    navToggle.textContent=nav?'›':'‹';navToggle.setAttribute('aria-expanded',String(!nav));
    peopleToggle.textContent=people?'选择学生 ›':'‹';peopleToggle.setAttribute('aria-expanded',String(!people));
    navToggle.setAttribute('aria-label',nav?'展开导航':'收起导航');
    peopleToggle.setAttribute('aria-label',people?'展开学生列表':'收起学生列表');
    navToggle.title=nav?'展开左侧板块导航':'收起左侧导航，扩大内容区域';
    peopleToggle.title=people?'展开学生列表，切换查看其他同学':'收起学生列表，扩大当前同学的积分明细';
  }
  function saveLayoutPrefs(){try{localStorage.setItem('pps_layout_preferences',JSON.stringify(layoutPrefs));}catch(e){}applyLayoutPrefs();}
  navToggle.onclick=function(){layoutPrefs.navCollapsed=!layoutPrefs.navCollapsed;saveLayoutPrefs();};
  peopleToggle.onclick=function(){layoutPrefs.peopleCollapsed=!layoutPrefs.peopleCollapsed;saveLayoutPrefs();};
  applyLayoutPrefs();
  function dashboard(){
    C.ensure(APP);var waiting=pending(),latest=APP.screeningHistory.length?APP.screeningHistory[APP.screeningHistory.length-1]:null;
    var cards=[
      ['import','01','导入或补充资料','上传信息收集表，新增同学或更新老同学材料。','开始导入'],
      ['members','02','人员与积分','查找学生，查看分项明细、补学号或移除人员。','查看人员'],
      ['review','03','核对待审核材料','确认系统无法确定的奖项级别、类别和职务。','去核对'],
      ['screening','04','新老同学汇总筛选','选择新批次，再勾选老同学，生成统一名单。','开始筛选'],
      ['history','05','历史筛选结果','查看和导出当时留存的名单、分数及评分依据。','查看历史'],
      ['backup','06','备份与恢复','保存完整资料副本，必要时恢复工作数据。','管理备份']
    ];
    el('workspaceDashboard').innerHTML='<div class="workspace-welcome"><div><span class="workspace-eyebrow">国际交流学院 · 管理员工作台</span><h2>今天要处理哪项工作？</h2><p>从资料录入到结果留存，各板块独立管理，学生资料保持共享。</p></div><button class="btn btn-p" data-workspace="import">＋ 导入本批资料</button></div>'+
      '<div class="workspace-stats"><button data-workspace="members"><span>人员总数</span><strong>'+APP.members.length+'</strong><small>新老同学统一管理</small></button><button data-workspace="review"><span>待审核人员</span><strong>'+waiting.length+'</strong><small>'+waiting.reduce(function(n,r){return n+r.count;},0)+' 项材料等待核对</small></button><button data-workspace="screening"><span>本次已勾选</span><strong>'+APP.screeningDraft.selectedIds.length+'</strong><small>可跨批次继续选择</small></button><button data-workspace="history"><span>已留存结果</span><strong>'+APP.screeningHistory.length+'</strong><small>保留当时分数及依据</small></button></div>'+
      '<div class="workspace-section-heading"><h3>常用板块</h3><span>按实际工作顺序选择入口</span></div><div class="workspace-card-grid">'+cards.map(function(c){return '<button class="workspace-card" data-workspace="'+c[0]+'"><span class="workspace-card-number">'+c[1]+'</span><h3>'+c[2]+'</h3><p>'+c[3]+'</p><span class="workspace-card-link">'+c[4]+' <span aria-hidden="true">→</span></span></button>';}).join('')+'</div>'+
      '<div class="workspace-bottom-grid"><article class="workspace-help"><h3>本次筛选进度</h3><p>'+(APP.screeningDraft.name?safe(APP.screeningDraft.name):'尚未设置本次筛选名称')+'</p><p>已选 '+APP.screeningDraft.selectedIds.length+' 人。'+(APP.screeningDraft.period?'统计口径：'+safe(APP.screeningDraft.period):'保存前请确认新老同学适用同一材料统计口径。')+'</p><button class="btn btn-b" data-workspace="screening">继续选择与筛选</button></article><article class="workspace-help"><h3>最近留存的结果</h3><p>'+(latest?safe(latest.name)+' · '+latest.rows.length+' 人':'暂时没有留存结果')+'</p><p>'+(latest?'留存时间：'+safe(new Date(latest.createdAt).toLocaleString('zh-CN')):'完成选人、核对材料后，可保存一份不会随后续修改变化的结果。')+'</p><button class="btn" data-workspace="history">查看历史结果</button></article></div>';
    bindRoutes(el('workspaceDashboard'));
  }
  function reviewPage(){
    var rows=pending();el('workspaceReview').innerHTML='<div class="workspace-page-title"><span>材料核对</span><h2>待审核材料</h2><p>这些材料的信息不足以自动确定分数，请结合原始材料核对。确认结果会保留在人员明细中。</p></div>'+(rows.length?'<div class="workspace-review-list">'+rows.map(function(r){return '<article><div><strong>'+safe(r.member['姓名'])+'</strong><span>'+safe(r.member['班级'])+'</span><small>'+safe(r.member['学号']||'未补学号')+'</small></div><span class="workspace-review-count">'+r.count+' 项待审核</span><button class="btn btn-p" data-review-member="'+safe(r.member._memberId)+'">核对该同学材料</button></article>';}).join('')+'</div>':'<div class="workspace-help"><h3>目前没有待审核材料</h3><p>后续导入新资料后，无法确定的奖项和职务会显示在这里。</p></div>');
    var start=document.createElement('button');start.type='button';start.className='btn btn-p';start.id='startContinuousReview';start.textContent='开始连续审核';start.disabled=!rows.length;start.onclick=function(){AdminTools.startReview();};el('workspaceReview').insertBefore(start,el('workspaceReview').firstChild);
    el('workspaceReview').querySelectorAll('[data-review-member]').forEach(function(b){b.onclick=function(){APP.curIdx=APP.members.findIndex(function(m){return m._memberId===b.dataset.reviewMember;});navigate('members');switchMainTab('uncertain');};});
  }
  function applyPeopleFilter(){
    var count=0,q=peopleQuery.toLowerCase();
    el('memberList').querySelectorAll('.mitem').forEach(function(row){
      var index=Number(row.getAttribute('data-mi')),m=APP.members[index];
      var show=!!m&&(!peopleClass||String(m['班级']||'')===peopleClass)&&(!q||[m['姓名'],m['班级'],m['学号']].join(' ').toLowerCase().indexOf(q)>=0);
      row.style.display=show?'':'none';if(show)count++;
      row.onmouseenter=null;row.onmouseleave=null;
    });
    el('memberListMeta').textContent='显示 '+count+' 人 / 共 '+APP.members.length+' 人';
    el('memberSearchEmpty').classList.toggle('hide',count>0||APP.members.length===0);
  }
  function syncPeopleFilters(){
    var classes=Array.from(new Set(APP.members.map(function(m){return String(m['班级']||'');}).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,'zh-CN');});
    if(peopleClass&&classes.indexOf(peopleClass)<0)peopleClass='';
    el('memberClassFilter').innerHTML='<option value="">全部班级</option>'+classes.map(function(cls){return '<option value="'+safe(cls)+'">'+safe(cls)+'</option>';}).join('');
    el('memberClassFilter').value=peopleClass;applyPeopleFilter();
  }
  function syncPersonTabs(){
    el('mainTabs').querySelectorAll('[role=tab]').forEach(function(tab){var name=tab.getAttribute('data-tab');tab.setAttribute('aria-selected',String(tab.classList.contains('active')));tab.setAttribute('aria-controls',name==='overview'?'panelOverview':name==='detail'?'panelDetail':'panelUncertain');});
  }
  function personOverview(){
    if(!APP.members.length)return;
    var m=APP.members[APP.curIdx]||APP.members[0];classifyMember(m);var fin=calc(m,!!APP.coef);
    el('personProfileMeta').textContent='学号：'+(m['学号']||'尚未补充')+' · 批次：'+C.batchNames(APP,m)+(APP.coef?' · 当前采用前期×0.6系数':'');
    var count=(m._unc||[]).length;el('personReviewStatus').textContent=count?count+' 项材料待审核':'无待审核项';el('personReviewStatus').dataset.state=count?'pending':'ready';
    var groups=[{key:'ac',name:'学业能力',names:AC,values:fin.ac,total:fin.acT,cap:R.acCap,offset:0},{key:'pt',name:'党性成长',names:PS,values:fin.pt,total:fin.ptT,cap:R.ptCap,offset:6},{key:'dc',name:'纪律约束',names:DS,values:fin.dc,total:fin.dcT,cap:null,offset:12}];
    el('personOverviewGroups').innerHTML=groups.map(function(g){
      var sum=g.values.reduce(function(n,v){return n+v;},0),note=g.cap!=null?(sum>g.cap?'分项合计 '+fmt(sum)+' 分，按上限计 '+fmt(g.total)+' 分':'本板块上限 '+g.cap+' 分'):'按学院现行纪律扣分标准计分';
      return '<section class="person-score-group" data-score-board="'+g.key+'"><header><h3>'+g.name+'</h3><strong>'+fmt(g.total)+'<small> 分</small></strong></header><div>'+g.names.map(function(name,i){return '<button type="button" class="person-score-line" data-person-sub="'+(g.offset+i)+'"><span>'+safe(name)+'</span><strong class="'+(g.values[i]<0?'negative':g.values[i]===0?'zero':'')+'">'+fmt(g.values[i])+'</strong><span class="person-score-chevron" aria-hidden="true">›</span></button>';}).join('')+'</div><p>'+safe(note)+'</p></section>';
    }).join('');
    el('personOverviewGroups').querySelectorAll('[data-person-sub]').forEach(function(button){button.onclick=function(){editSub(Number(button.dataset.personSub));};});
    syncPersonTabs();
  }
  function visibility(){
    var active=current==='dashboard'?'workspaceDashboard':current==='import'?'workspaceImport':current==='members'?'workspaceMembers':current==='review'?'workspaceReview':current==='criteria'?'workspaceCriteria':current==='backup'?'workspaceBackup':current==='recycle'?'workspaceRecycle':current==='audit'?'workspaceAudit':current==='summary'?'viewSummary':'workflowView';
    panelIds.forEach(function(id){el(id).classList.toggle('hide',id!==active);});
    el('emptyState').classList.add('hide');el('viewPersonal').classList.toggle('hide',current!=='members'||!APP.members.length);
    el('workspaceNoPerson').classList.toggle('hide',current!=='members'||!!APP.members.length);
    el('panelCriteria').classList.toggle('hide',current!=='criteria');
    document.body.dataset.page=current;document.body.classList.toggle('workspace-locked',!!(CLOUD_ENABLED&&!_cloudKey));
    el('btnExport').classList.toggle('hide',current!=='screening'&&current!=='summary');
    el('workspaceSidebar').querySelectorAll('[data-workspace]').forEach(function(b){var yes=b.dataset.workspace===current;b.classList.toggle('active',yes);if(yes)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    el('workspaceRoutebar').innerHTML='<span>管理员工作台 <span aria-hidden="true">/</span> <strong>'+safe(pages[current])+'</strong></span>'+(current==='dashboard'?'':'<button class="btn btn-s" data-workspace="dashboard">返回工作台</button>');bindRoutes(el('workspaceRoutebar'));
  }
  function refresh(){visibility();if(current==='recycle'&&window.AdminTools)AdminTools.recycle();if(current==='audit'&&window.AdminTools)AdminTools.audit();if(current==='dashboard')dashboard();if(current==='review')reviewPage();if(current==='members'){syncPeopleFilters();personOverview();}if(current==='history'){var title=el('workflowView').querySelector('.workflow-heading h2');if(title)title.textContent='历史筛选结果';}}
  function navigate(page){
    if(!pages[page])page='dashboard';if(routing)return;
    var changed=current!==page;
    routing=true;current=page;
    try{
      if(page!=='screening'&&page!=='history'&&AppWorkflow.isOpen())AppWorkflow.close();
      el('panelCriteria').classList.add('hide');
      if(page==='members'){window.render();switchMainTab('overview');}
      else if(page==='summary'){renderSummaryTable();el('btnExport').textContent='导出全部汇总';}
      else if(page==='criteria'){renderCriteria();}
      else if(page==='screening'||page==='history'){openWorkflow();}
      refresh();el('mainContent').scrollTop=0;
      if(changed)animatePanel(el('mainContent'));
    }finally{routing=false;}
  }
  function animatePanel(panel){
    if(!panel||!panel.animate||(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches))return;
    panel.animate([{opacity:.65},{opacity:1}],{duration:170,easing:'ease-out'});
  }
  el('searchMember').addEventListener('input',function(){peopleQuery=this.value.trim();applyPeopleFilter();});
  el('memberClassFilter').onchange=function(){peopleClass=this.value;applyPeopleFilter();};
  var previousSwitchTab=window.switchMainTab;window.switchMainTab=function(tab){previousSwitchTab(tab);syncPersonTabs();animatePanel(el(tab==='overview'?'panelOverview':tab==='detail'?'panelDetail':'panelUncertain'));};
  var previousRender=window.render;window.render=function(){previousRender();if(!routing)refresh();};
  var previousApply=window._applyData;window._applyData=function(data){previousApply(data);navigate('dashboard');};
  var openWorkflow=AppWorkflow.open;AppWorkflow.open=function(){navigate('screening');};
  var closeWorkflow=AppWorkflow.close;AppWorkflow.close=function(){if(routing)return closeWorkflow();navigate('members');};
  function captureRoute(id,page){el(id).addEventListener('click',function(e){e.stopImmediatePropagation();navigate(page);},true);}
  captureRoute('btnWorkflow','screening');captureRoute('btnOpenCrit','criteria');captureRoute('btnShowSummary','summary');captureRoute('btnBackSummary','members');captureRoute('globalUncBadge','review');
  el('workspaceDownloadTemplate').onclick=function(){el('btnTpl').click();};
  el('workspaceDownloadBackup').onclick=function(){el('btnBackup').click();};
  el('workspaceRestoreBackup').onclick=function(){el('restoreFile').click();};
  el('workspaceRemoveMember').onclick=function(){
    if(_cloudConflict){toast('请先处理云端保存冲突。','err');return;}
    var m=APP.members[APP.curIdx];if(!m)return;
    if(!confirm('将“'+m['姓名']+'”移入回收站？可随时单独恢复，历史筛选结果保留。'))return;
    _captureManualItems(m);AdminCore.archive(APP,m._memberId);svNow();navigate('members');toast('已移入人员回收站，可从左侧导航恢复。请确认云端保存状态。');
  };
  window.AdminWorkspace={navigate:navigate,currentPage:function(){return current;},refresh:refresh};
  navigate('dashboard');
})();
