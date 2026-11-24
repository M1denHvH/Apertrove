// Qualified Canon BULB lifecycle only. The adapter owns the proven per-model
// start/end route and UI-lock contract; camera events provide exposure time.
const UNQUALIFIED = 'BULB_PROTOCOL_UNQUALIFIED';
function createBulbControl(io = {}) {
  let state = { status:'idle', available:io.qualified === true, reason:io.qualified === true ? null : UNQUALIFIED, elapsedSeconds:null, elapsedSource:null, confirmation:'command-accepted', startAcknowledged:false };
  let lockOwed = false, endOwed = false, changing = false, connectionLost = false, settled = Promise.resolve(), resolveSettled;
  const publish = patch => { state = { ...state, ...patch }; io.onState?.({ ...state }); return { ...state }; };
  const requireAdapter = () => {
    if (!state.available || ['lock','start','end','unlock'].some(key => typeof io[key] !== 'function')) {
      const error = Error('BULB недоступен: протокол этой камеры и версии SDK не квалифицирован.'); error.code = UNQUALIFIED; throw error;
    }
  };
  const connected = () => { if(connectionLost)throw Error('Соединение потеряно: завершение BULB не подтверждено.'); };
  async function unlock() {
    connected();
    if (!lockOwed) return;
    await io.unlock();
    connected();
    lockOwed = false;
  }
  async function start(args = {}) {
    requireAdapter();
    connected();
    if (changing || endOwed || lockOwed || state.status === 'error' && state.confirmation === 'unknown') throw Error('Предыдущая BULB-операция ещё не завершена.');
    io.ensure?.(args);
    changing = true;
    settled=new Promise(resolve=>{resolveSettled=resolve;});
    publish({ status:'starting', elapsedSeconds:null, elapsedSource:null, error:undefined, confirmation:'unknown', startAcknowledged:false });
    try {
      lockOwed = true;
      await io.lock();
      connected();
      endOwed = true;
      await io.start(args);
      connected();
      return publish({ status:'exposing', startAcknowledged:true, confirmation:'command-accepted' });
    } catch (error) {
      if(connectionLost){publish({status:'error',confirmation:'unknown',error:error.message});throw error;}
      // Cleanup follows even when dispatch may have happened before a throw.
      let cleanupError;
      if (endOwed) try { await io.end(); connected(); endOwed = false; } catch (cause) { cleanupError = cause; }
      try { await unlock(); } catch (cause) { cleanupError ||= cause; }
      publish({ status:'error', confirmation:cleanupError ? 'unknown' : 'command-accepted', error:error.message, cleanupError:cleanupError?.message, startAcknowledged:false });
      throw cleanupError || error;
    } finally { changing = false; resolveSettled(); }
  }
  async function stop() {
    if (changing) throw Error('Дождитесь завершения текущей команды BULB.');
    if (!endOwed && !lockOwed) return { ...state };
    changing = true;
    settled=new Promise(resolve=>{resolveSettled=resolve;});
    publish({ status:'stopping' });
    let error;
    try {
      if (endOwed) try { await io.end(); connected(); endOwed = false; } catch (cause) { error = cause; }
      if(connectionLost){publish({status:'error',confirmation:'unknown',error:'Соединение потеряно: завершение BULB не подтверждено.'});throw Error(state.error);}
      try { await unlock(); } catch (cause) { error ||= cause; }
      if(connectionLost){publish({status:'error',confirmation:'unknown',error:'Соединение потеряно: завершение BULB не подтверждено.'});throw Error(state.error);}
      if (error) { publish({ status:'error', confirmation:'unknown', error:error.message }); throw error; }
      return publish({ status:'idle', confirmation:'command-accepted', error:undefined, cleanupError:undefined });
    } finally { changing = false; resolveSettled(); }
  }
  function event(seconds) {
    if (!state.startAcknowledged || !['exposing','stopping'].includes(state.status) || !Number.isSafeInteger(seconds) || seconds < 0 || state.elapsedSeconds !== null && seconds < state.elapsedSeconds) return false;
    publish({ elapsedSeconds:seconds, elapsedSource:'camera-event' });
    return true;
  }
  function disconnected() {
    const unknown = changing || endOwed || lockOwed || state.status === 'error' && state.confirmation === 'unknown';
    connectionLost=true;
    endOwed = false; lockOwed = false;
    return publish({ status:unknown ? 'error' : 'idle', confirmation:unknown ? 'unknown' : 'command-accepted', error:unknown ? 'Соединение потеряно: завершение BULB не подтверждено.' : undefined });
  }
  const shutdown=async()=>{if(changing)await settled;return stop();};
  return { start, stop, event, disconnected, shutdown, isBusy:() => changing || endOwed || lockOwed || state.status === 'error' && state.confirmation === 'unknown', snapshot:() => ({ ...state }) };
}
module.exports = { createBulbControl, UNQUALIFIED };
