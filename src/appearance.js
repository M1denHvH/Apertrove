import { t, localized } from "./i18n.js";
import '../electron/remote/appearance.js';
export const ACCENTS=localized(() => ([
  {name:t("palette.sage"),value:'#7f9c69'}, {name:t("palette.azure"),value:'#669dd8'},
  {name:t("palette.lavender"),value:'#a08bd5'}, {name:t("palette.rose"),value:'#ce879d'},
  {name:t("palette.amber"),value:'#caa05c'}, {name:t("palette.teal"),value:'#54a99c'}
]));
export function applyAppearance(settings={}){
  return globalThis.ApertroveAppearance.apply(settings,matchMedia('(prefers-color-scheme: dark)').matches);
}
