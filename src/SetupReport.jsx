import { t, localized, legacy, date, number } from "./i18n.js";
import React from 'react';
import { Activity, Aperture, BatteryMedium, Camera, Check, ChevronDown, CircleAlert, CircleHelp, Cpu, HardDrive, Layers, Minus, TriangleAlert } from 'lucide-react';

export const formatSpace = bytes => number(bytes / 1024 ** 3, {maximumFractionDigits:1}) + t("diagnostics.gib");

const statuses = localized(() => ({
  ready: [t("diagnostics.available"), Check],
  temporary: [t("diagnostics.temporarily_unavailable"), TriangleAlert],
  unimplemented: [t("diagnostics.not_yet_in_apertrove"), Layers],
  unsupported: [t("diagnostics.unsupported_by_camera"), Minus],
  unknown: [t("diagnostics.unconfirmed"), CircleHelp],
  error: [t("diagnostics.read_error"), CircleAlert]
}));

function describe(row) {
  return legacy(row.detail);
}

export function SetupAccordion({ title, icon: Icon, aside, children, initialOpen = false, className = '' }) {
  return <details className={`setup-accordion ${className}`} open={initialOpen || undefined}>
    <summary>{Icon && <Icon className="setup-group-icon" size={16}/>}<span>{title}</span>{aside && <small>{aside}</small>}<ChevronDown className="setup-chevron" size={16}/></summary>
    <div className="setup-accordion-body">{children}</div>
  </details>;
}

export default function CapabilityReport({ report, connected }) {
  if (!report) return null;
  const facts = [
    [t("diagnostics.firmware"), report.firmware], [t("diagnostics.sdk_file_version"), report.sdkVersion], [t("diagnostics.mode"), report.mode],
    [t("diagnostics.lens"), report.lens], [t("diagnostics.shots_remaining"), report.availableShots],
    [t("diagnostics.description"), report.description !== report.model ? report.description : null]
  ];
  const battery = report.battery;
  const ready = report.rows.filter(row => row.status === 'ready').length;
  const errorCount=report.rows.filter(row=>row.status==='error').length;
  const warningCount=report.rows.filter(row=>row.status==='temporary').length;
  const groups = Map.groupBy(report.rows, row => row.group);
  return <section className="capability-report" aria-label={t("diagnostics.capability_report")}>
    <div className="capability-camera">
      <header><span className="setup-icon-tile"><Camera size={25}/></span><div><h2>{report.model}</h2>
        <p>{connected ? t("diagnostics.camera_connected") : t("diagnostics.last_saved_check")} · {date(report.checkedAt,{dateStyle:'medium',timeStyle:'short'})}</p></div>
        {Number.isFinite(battery) && battery >= 0 && battery <= 100 && <span className="capability-battery" aria-label={t("diagnostics.battery", { v0: battery })}><BatteryMedium size={17}/>{battery}%</span>}
      </header>
      <dl className="capability-facts">{facts.filter(([, value]) => value != null && value !== '').map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {report.storage.filter(volume => volume.type !== 0).map((volume, index) => <div className="setup-volume" key={index}><HardDrive size={15}/>
        <span>{volume.label || t("diagnostics.storage", { v0: index + 1 })}</span>
        <small>{t('common.free_space',{free:formatSpace(volume.free),total:formatSpace(volume.capacity)})}{volume.access === 0 ? t("diagnostics.read_only") : ''}</small>
      </div>)}
    </div>
    <div className="capability-summary">
      <h2>{t("diagnostics.what_apertrove_checked")}</h2>
      <p>{ready ? t("diagnostics.available_of_expand_a_category_to_see_the", { v0: ready, v1: report.rows.length }) : t("diagnostics.no_controls_have_been_confirmed_yet_expand_a")}</p>
      {(errorCount>0||warningCount>0)&&<p>{[errorCount>0?t('count.errors',{count:errorCount}):null,warningCount>0?t('count.warnings',{count:warningCount}):null].filter(Boolean).join(' · ')}</p>}
    </div>
    {[...groups].map(([group, rows], index) => <SetupAccordion key={group} title={legacy(group)}
      icon={[Aperture, Activity, Camera, Aperture, HardDrive, Cpu][index % 6]}
      aside={`${rows.filter(row => row.status === 'ready').length} / ${rows.length}`} initialOpen={index===0}>
      <ul>{rows.map((row, rowIndex) => {
        const [label, StatusIcon] = statuses()[row.status] || statuses().unknown;
        return <li key={row.id} style={{ '--row-delay': `${Math.min(rowIndex, 5) * 20}ms` }}>
          <div><strong>{legacy(row.label)}</strong><small>{describe(row)}</small></div>
          <span className={`capability-status ${row.status}`}><StatusIcon size={13}/>{label}</span>
        </li>;
      })}</ul>
      {rows.some(row => row.status === 'unknown') && <p className="capability-note">{t("diagnostics.some_features_can_only_be_confirmed_while_using")}</p>}
    </SetupAccordion>)}
  </section>;
}
