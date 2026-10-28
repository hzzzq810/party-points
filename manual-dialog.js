(function(){
  'use strict';
  var trigger=document.getElementById('adminManualLink'),dialog=document.getElementById('adminManualDialog'),article=document.getElementById('manualDialogArticle');
  trigger.addEventListener('click',function(){
    if(dialog.open)return;
    dialog.showModal();article.scrollTop=0;document.getElementById('manualDialogClose').focus();
  });
  document.getElementById('manualDialogClose').addEventListener('click',function(){dialog.close();});
  dialog.addEventListener('click',function(e){if(e.target===dialog)dialog.close();});
  dialog.addEventListener('close',function(){trigger.focus();});
  document.querySelectorAll('[data-manual-target]').forEach(function(button){
    button.addEventListener('click',function(){
      var target=document.getElementById(button.dataset.manualTarget);
      var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Scroll only the article so the dialog header and directory remain in place.
      article.scrollTo({top:Math.max(0,article.scrollTop+target.getBoundingClientRect().top-article.getBoundingClientRect().top-22),behavior:reduced?'instant':'smooth'});
      document.querySelectorAll('[data-manual-target]').forEach(function(b){b.classList.toggle('active',b===button);});
    });
  });
})();
