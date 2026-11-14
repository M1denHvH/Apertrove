import React, { useId, useLayoutEffect, useRef } from 'react';
import { reducedMotionQuery } from './motion';

const center = [160, 107];
const point = (radius, angle) => {
  const radians = angle * Math.PI / 180;
  return [center[0] + radius * Math.cos(radians), center[1] + radius * Math.sin(radians)].map(value => value.toFixed(3)).join(' ');
};
const bladeCount = 6;
const bladeAngle = 360 / bladeCount;
const closedRadius = 23;
const openRadius = 37;
const irisTiming = { opening: 1600, open: 600, closing: 1400, closed: 900 };
const cycleDuration = Object.values(irisTiming).reduce((total, time) => total + time, 0);
const bladeStart = point(54,-111);
const bladeEnd = point(54,-39);
const ease = t => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t)))) / 2;

function bladePath(radius) {
  const travel = radius - closedRadius;
  return `M${bladeStart} A54 54 0 0 1 ${bladeEnd} Q${point(44+travel*.2,-14)} ${point(radius,-10)} L${point(radius,-70)} Q${point(41+travel*.4,-81)} ${bladeStart}Z`;
}

function opening(radius) {
  return Array.from({length:bladeCount},(_,i)=>point(radius,-10+i*bladeAngle)).join(' ');
}

function Iris({ id, clip, performanceMode }) {
  const iris = useRef(null), blade = useRef(null), hole = useRef(null);
  useLayoutEffect(() => {
    const group = iris.current, path = blade.current, polygon = hole.current;
    const reduced = matchMedia(reducedMotionQuery);
    let nativeVisible = true, inView = true, start = null, elapsed = 0, frame = null, timer = null;
    let last = -1;
    function draw(progress) {
      if (last === progress) return;
      last = progress;
      const radius = closedRadius + (openRadius - closedRadius) * progress;
      path.setAttribute('d', bladePath(radius));
      polygon.setAttribute('points', opening(radius));
      if (progress) group.setAttribute('transform', `rotate(${(-12 * progress).toFixed(3)} ${center.join(' ')})`);
      else group.removeAttribute('transform');
    }
    function stop() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = timer = null;
      start = null;
    }
    function tick(now) {
      frame = null;
      const { opening: openingTime, open, closing, closed } = irisTiming;
      const position = Math.max(0, now - start) % cycleDuration;
      elapsed = position;
      const closeStart = openingTime + open, closeEnd = closeStart + closing;
      if (position < openingTime) draw(ease(position / openingTime));
      else if (position < closeStart) draw(1);
      else if (position < closeEnd) draw(1 - ease((position - closeStart) / closing));
      else draw(0);
      if ((position >= openingTime && position < closeStart) || position >= closeEnd) {
        const holdEnd = position < closeStart ? closeStart : closeEnd + closed;
        timer = setTimeout(() => { timer = null; frame = requestAnimationFrame(tick); }, holdEnd - position);
      } else frame = requestAnimationFrame(tick);
    }
    function update() {
      if (performanceMode || reduced.matches) {
        stop();
        elapsed = 0;
        draw(0);
      } else if (!nativeVisible || document.hidden || !inView) stop();
      else if (start === null && frame === null) {
        // Establish the time origin on the first rendered frame.
        frame = requestAnimationFrame(now => { start = now - elapsed; tick(now); });
      }
    }
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; if (!inView || start === null) { stop(); update(); } });
    observer.observe(group);
    const unsubscribe = window.focal?.onWindowVisible?.(visible => { nativeVisible = visible; update(); });
    document.addEventListener('visibilitychange', update);
    reduced.addEventListener('change', update);
    draw(0);
    update();
    return () => {
      stop();
      observer.disconnect();
      unsubscribe?.();
      document.removeEventListener('visibilitychange', update);
      reduced.removeEventListener('change', update);
    };
  }, [performanceMode]);

  return <g clipPath={`url(#${clip})`}>
    <defs><path id={id} ref={blade} d={bladePath(closedRadius)}/></defs>
    <g className="optics-iris" ref={iris}>
      {Array.from({length:bladeCount},(_,index) => <use key={index} className="optics-blade" href={`#${id}`} transform={`rotate(${index * bladeAngle} ${center.join(' ')})`}/>)}
      <polygon className="optics-opening" ref={hole} points={opening(closedRadius)}/>
    </g>
  </g>;
}

function Optics({ ready, glass, clip, performanceMode }) {
  return <>
    <circle className="optics-rim" cx="160" cy="107" r="78"/>
    <g className="optics-scale">{Array.from({length:60},(_,i)=>
      <path key={i} d={`M${point(i%5===0?66:69,i*6)} L${point(72,i*6)}`}/>)}</g>
    <circle className="optics-glass" cx="160" cy="107" r="62" fill={`url(#${glass})`}/>
    <circle className="optics-inner" cx="160" cy="107" r="50"/>
    <path className="art-register" d="M160 15v9m0 166v9M68 107h9m166 0h9"/>
    {ready ? <g className="optics-confirm">
      <circle cx="160" cy="107" r="37"/>
      <path className="art-check" pathLength="1" d="m144 107 11 11 23-24"/>
    </g> : <Iris id={clip+'-blade'} clip={clip} performanceMode={performanceMode}/>}
  </>;
}

function Connection() {
  return <>
    <path className="art-link" d="M94 121h40m52 0h37"/>
    <path className="art-signal" pathLength="1" d="M94 121h40m52 0h37"/>
    <g className="art-device">
      <path d="M34 86h14l7-10h19l7 10h12a7 7 0 0 1 7 7v31a7 7 0 0 1-7 7H34a7 7 0 0 1-7-7V93a7 7 0 0 1 7-7Z"/>
      <circle cx="64" cy="108" r="15"/><circle className="art-accent" cx="64" cy="108" r="8"/>
      <path d="M82 95h8"/>
    </g>
    <g className="art-device">
      <rect x="135" y="104" width="50" height="34" rx="8"/>
      <path className="art-accent" d="M147 121h21m-5-5 5 5-5 5m-9-5v-8h5m-2 8v8h5"/>
    </g>
    <g className="art-device">
      <rect x="222" y="80" width="71" height="48" rx="6"/>
      <path d="M257 129v13m-15 0h30m-41-23h53"/>
      <path className="art-check art-link-check" pathLength="1" d="m246 102 8 8 15-16"/>
    </g>
  </>;
}

function Station({ step }) {
  return <g className="art-device art-station">
    <path className="art-register" d="M90 57V44h13m114 0h13v13M90 156v13h13m114 0h13v-13"/>
    {step === 'environment' && <>
      <rect x="119" y="65" width="82" height="82" rx="13"/>
      <rect x="134" y="80" width="52" height="52" rx="7"/>
      <path d="M135 65V54m17 11V54m16 11V54m17 11V54m-50 93v11m17-11v11m16-11v11m17-11v11m16-77h11m-11 17h11m-11 16h11m-11 17h11m-93-50h-11m11 17h-11m11 16h-11m11 17h-11"/>
      <path className="art-accent" d="M145 117v-21h12l6 6v15Zm12-21v7h6m8-7v21"/>
      <path className="art-scan" d="M126 106h68"/>
    </>}
    {step === 'workspace' && <>
      <path d="M108 88a8 8 0 0 1 8-8h29l11 10h47a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8h-87a8 8 0 0 1-8-8Z"/>
      <path d="M120 80v-6a8 8 0 0 1 8-8h30l11 10h30"/>
      <path className="art-accent" d="M128 110h30m-30 13h44"/>
    </>}
    {step === 'tutorial' && <>
      <rect x="105" y="66" width="110" height="82" rx="9"/>
      <path d="M106 85h108m-81 0v62"/>
      <rect className="art-accent" x="147" y="97" width="51" height="33" rx="4"/>
      <path d="M114 98h10m-10 13h10m-10 13h10m53-12h-9m4-5v10"/>
    </>}
  </g>;
}

export default function SetupArtwork({ step, state, performanceMode }) {
  const id = useId();
  const optical = step === 'welcome' || step === 'ready';
  return <div className="setup-artwork" data-scene={step} data-state={state} aria-hidden="true">
    <svg viewBox="0 0 320 214" fill="none">
      <defs>
        <radialGradient id={id}><stop stopColor="currentColor" stopOpacity=".22"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></radialGradient>
        <linearGradient id={id+'-glass'} x1="0" y1="0" x2="1" y2="1"><stop className="art-glass-light"/><stop offset="1" className="art-glass-dark"/></linearGradient>
        <clipPath id={id+'-iris'}><circle cx={center[0]} cy={center[1]} r="56"/></clipPath>
      </defs>
      <ellipse className="art-light" cx="160" cy="111" rx="146" ry="100" fill={`url(#${id})`}/>
      <path className="art-register art-corners" d="M20 44V27h17m246 0h17v17M20 170v17h17m246 0h17v-17"/>
      {optical ? <Optics ready={step==='ready'} glass={id+'-glass'} clip={id+'-iris'} performanceMode={performanceMode}/> : ['discovery','connection'].includes(step) ? <Connection/> : <Station step={step}/>}
      {!optical && ['success','warning','error'].includes(state) && step!=='connection' && step!=='discovery' && <g className="art-seal">
        <circle cx="212" cy="145" r="14"/>
        {state==='success' ? <path className="art-check" pathLength="1" d="m205 145 5 5 9-10"/> : <path d="M212 139v7m0 4v1"/>}
      </g>}
    </svg>
  </div>;
}
