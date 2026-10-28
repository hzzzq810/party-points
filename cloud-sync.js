(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CloudSync=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function error(message,code){var e=new Error(message);e.code=code;return e;}
  function create(){
    var base=null;
    return{
      adopt:function(record){if(!record||!record._id||!record.iv)throw error('云端记录缺少版本信息，请重新登录。','INVALID_BASE');base=Object.assign({},record);},
      getBase:function(){return base&&Object.assign({},base);},
      write:async function(collection,fields){
        if(!base)throw error('没有已读取的云端版本，已停止保存。请先登录。','INVALID_BASE');
        if(fields.key!==base.key)throw error('保存目标与登录时读取的数据不一致，已停止。','CLOUD_CONFLICT');
        var expected={_id:base._id,key:base.key,iv:base.iv};
        if(base.updatedAt!=null)expected.updatedAt=base.updatedAt;
        if(base.revision!=null)expected.revision=base.revision;
        var next=Object.assign({},fields,{revision:(Number(base.revision)||0)+1});
        // One conditional database update is the compare-and-swap; never fall back to an unconditional write.
        var result=await collection.where(expected).update(next);
        if(result&&result.code)throw error(result.message||result.code,result.code);
        if(!result||result.updated!==1){
          if(result&&result.updated===0)throw error('另一台电脑已经保存了更新。本机修改已保留，请先备份，再读取云端最新版。','CLOUD_CONFLICT');
          throw error('数据库未确认更新数量，已暂停后续保存，请读取云端确认结果。','CLOUD_CONFLICT');
        }
        base=Object.assign({},base,next);return Object.assign({},base);
      }
    };
  }
  return{create:create};
});
