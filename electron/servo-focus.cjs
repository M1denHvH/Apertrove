// AFMode readback establishes the selected mode. An accepted held AF command
// establishes command ownership, never acquisition or optical tracking success.
const { PROPS } = require('./camera-values.cjs');
function createServoFocus(io) {
  let state = { enabled:false, status:'off', confirmation:'command-accepted', trackingConfirmed:false };
  let restoreMode, command, owedStop = false, changing = false, sessionValid = true;
  const publish = patch => { state = { ...state, ...patch, trackingConfirmed:false }; io.onState?.({ ...state }); return { ...state }; };
  // A held, accepted Servo command is a mode, not an unfinished request. Only
  // a transition or uncertain release excludes capture; AF ownership is separate.
  const busy = () => changing || sessionValid && state.enabled === null;
  function stop() {
    if (changing) throw Error('Дождитесь переключения AI Servo.');
    if (!owedStop) return { ...state };
    changing = true;
    publish({ status:'stopping' });
    try { io.command(command, 0, 'Остановка AI Servo'); }
    catch (error) {
      changing = false;
      publish({ enabled:null, status:'error', confirmation:'unknown', error:error.message });
      io.onUnknown?.(error);
      throw error;
    }
    owedStop = false;
    try {
      // A physical mode change takes priority over the saved setting.
      if (restoreMode !== undefined && io.get(PROPS.afMode) === 1) {
        io.set(PROPS.afMode, restoreMode);
        if (io.get(PROPS.afMode) !== restoreMode) throw Error('Камера не подтвердила восстановление режима AF.');
      }
      restoreMode = undefined;
      return publish({ enabled:false, status:'off', confirmation:'command-accepted', error:undefined });
    } catch (error) {
      restoreMode = undefined;
      publish({ enabled:false, status:'error', confirmation:'command-accepted', error:error.message });
      throw error;
    } finally { changing = false; }
  }
  function set({ enabled } = {}) {
    if (typeof enabled !== 'boolean') throw Error('Некорректное состояние AI Servo.');
    if (!enabled) return stop();
    if (changing) throw Error('Дождитесь переключения AI Servo.');
    if (owedStop) {
      if (state.enabled === true) return { ...state };
      throw Error('Остановка AI Servo не подтверждена. Отключите камеру.');
    }
    io.ensure();
    if (!sessionValid) throw Error('Повторно подключите камеру перед запуском AI Servo.');
    if (io.isCapturing?.() || io.isBusy?.()) throw Error('Дождитесь завершения текущей команды камеры.');
    if (io.canFocus?.() === false) throw Error('Объектив в MF. Переведите его переключатель в AF.');
    if (io.requiresLiveFocus?.() && !io.isLive()) throw Error('Для AI Servo включите Live View.');
    const original = io.get(PROPS.afMode), property = io.refresh().properties?.afMode;
    if (![0,1,2].includes(original)) throw Error('Камера не предоставила доступный режим AF.');
    if (original !== 1 && (!property?.writable || !property.allowed?.includes(1))) throw Error('AI Servo недоступен в текущем режиме камеры.');
    changing = true;
    publish({ status:'starting', enabled:false, confirmation:'unknown', error:undefined });
    try {
      if (original !== 1) {
        restoreMode = original;
        io.set(PROPS.afMode, 1);
      }
      if (io.get(PROPS.afMode) !== 1) throw Error('Камера не подтвердила AI Servo.');
      command = io.isLive() ? 0x102 : 4;
      // The release is owed even when a binding throws after native dispatch.
      owedStop = true;
      io.command(command, 1, 'Запуск AI Servo');
      return publish({ enabled:true, status:'running', confirmation:'command-accepted', method:command === 4 ? 'viewfinder' : 'live' });
    } catch (error) {
      changing = false;
      if (owedStop) {
        try { stop(); } catch (releaseError) { throw releaseError; }
      } else if (restoreMode !== undefined) {
        try { io.set(PROPS.afMode, restoreMode); if (io.get(PROPS.afMode) !== restoreMode) throw Error('Камера не подтвердила восстановление режима AF.'); }
        catch (restoreError) { error = restoreError; }
        finally { restoreMode = undefined; }
      }
      publish({ enabled:false, status:'error', confirmation:'command-accepted', error:error.message });
      throw error;
    } finally { changing = false; }
  }
  function disconnected() {
    const unknown = owedStop;
    owedStop = false; restoreMode = undefined; changing = false; sessionValid = false;
    return publish({ enabled:unknown ? null : false, status:'disconnected', confirmation:unknown ? 'unknown' : 'command-accepted', error:unknown ? 'Соединение потеряно до подтверждения остановки AI Servo.' : undefined });
  }
  function connected() {
    if (owedStop || changing) throw Error('Предыдущий AI Servo ещё не освобождён.');
    sessionValid = true; restoreMode = undefined; command = undefined;
    return publish({ enabled:false, status:'off', confirmation:'command-accepted', method:undefined, error:undefined });
  }
  function releaseAfterCapture(release) {
    const uncertain = busy();
    // PressShutterButton Completely -> Halfway keeps viewfinder Servo held.
    // EVF AF is a separate command; releasing the shutter does not release it.
    const halfway = !uncertain && owedStop && state.enabled === true && command === 4;
    try {
      const result = release(halfway ? 1 : 0);
      // A safety release must still be attempted if state became uncertain
      // after capture admission. It cannot turn that outcome into success.
      if (uncertain) throw Error('Состояние AI Servo не позволяет отпустить затвор.');
      return result;
    }
    catch (error) {
      if (owedStop) {
        publish({ enabled:null, status:'error', confirmation:'unknown', error:error.message });
        io.onUnknown?.(error);
      }
      throw error;
    }
  }
  return { set, stop, disconnected, connected, releaseAfterCapture, isBusy:busy, isHeld:() => owedStop, snapshot:() => ({ ...state }) };
}
module.exports = { createServoFocus };
