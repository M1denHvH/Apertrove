'use strict';

// A native worker may invoke the SDK initializer at most once, even when it
// throws or reports failure. The gate deliberately has no reset operation.
function createSdkInitializationGate(){
  let attempted=false;
  return Object.freeze({
    get attempted(){return attempted;},
    run(initialize){
      if(typeof initialize!=='function')throw TypeError('An initializer is required.');
      if(attempted)throw Object.assign(Error('SDK initialization was already attempted in this worker.'),{code:'SDK_INIT_ALREADY_ATTEMPTED'});
      attempted=true;
      return initialize();
    }
  });
}
module.exports={createSdkInitializationGate};
