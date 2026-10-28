(function(){
  'use strict';
  var trigger=document.getElementById('scoringRulesLink'),dialog=document.getElementById('scoringRulesDialog'),article=document.getElementById('rulesDialogArticle');
  trigger.addEventListener('click',function(){if(!dialog.open){dialog.showModal();article.scrollTop=0;document.getElementById('scoringRulesClose').focus();}});
  document.getElementById('scoringRulesClose').addEventListener('click',function(){dialog.close();});
  dialog.addEventListener('click',function(e){if(e.target===dialog)dialog.close();});
  dialog.addEventListener('close',function(){trigger.focus();});
  document.querySelectorAll('[data-rules-target]').forEach(function(button){button.addEventListener('click',function(){
    var target=document.getElementById(button.dataset.rulesTarget),reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    article.scrollTo({top:Math.max(0,article.scrollTop+target.getBoundingClientRect().top-article.getBoundingClientRect().top-22),behavior:reduced?'instant':'smooth'});
    document.querySelectorAll('[data-rules-target]').forEach(function(b){b.classList.toggle('active',b===button);});
  });});
})();
