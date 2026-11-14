import { t, date, number } from "./i18n.js";
import { readable } from './PhotoMetadata';

const hasValue = value => value !== null && value !== undefined && value !== '';
const show = (value, format) => hasValue(value) ? format(value) : null;
const unit = (value, suffix) => show(value, val => typeof val === 'number' ? `${val} ${suffix}` : val);

export function shotGroups(name, report) {
  const tags = report?.metadata || {};
  const file = report?.file || {};
  const exif = tags.exif || {};
  const ifd = tags.ifd0 || {};
  const width = exif.ExifImageWidth ?? exif.PixelXDimension ?? file.width ?? ifd.ImageWidth;
  const height = exif.ExifImageHeight ?? exif.PixelYDimension ?? file.height ?? ifd.ImageHeight;
  const captureDate = exif.DateTimeOriginal ?? exif.CreateDate;
  const extension = name?.match(/\.([^.]+)$/)?.[1]?.toUpperCase();
  const format = /^(CR2|CR3)$/.test(extension) ? extension : file.format?.toUpperCase() || extension;
  const focus = exif.FocusMode ?? ifd.FocusMode ?? tags.xmp?.FocusMode;
  const colorSpace = exif.ColorSpace === 65535 ? tags.icc?.ProfileDescription ?? t("shotDetails.uncalibrated")
    : exif.ColorSpace ?? tags.icc?.ProfileDescription ?? file.space;
  return [
    [t("shotDetails.exposure"), [
      [t("shotDetails.shutter_speed"), show(exif.ExposureTime, value => typeof value !== 'number' ? value : value > 0 && value < 1 ? t("shotDetails.1_s", { v0: Number((1 / value).toPrecision(5)) }) : t("shotDetails.s", { v0: value }))],
      [t("shotDetails.aperture"), show(exif.FNumber, value => `ƒ/${value}`)],
      ['ISO', exif.ISO ?? exif.PhotographicSensitivity],
      [t("shotDetails.exposure_compensation"), unit(exif.ExposureCompensation ?? exif.ExposureBiasValue, 'EV')],
      [t("shotDetails.shooting_mode"), exif.ExposureProgram ?? exif.ExposureMode]
    ]],
    [t("shotDetails.camera_and_optics"), [
      [t("shotDetails.manufacturer"), ifd.Make ?? exif.Make], [t("shotDetails.camera"), ifd.Model ?? exif.Model],
      [t("shotDetails.lens"), exif.LensModel ?? ifd.LensModel], [t("shotDetails.focal_length"), unit(exif.FocalLength, t("shotDetails.mm"))],
      [t("shotDetails.flash"), exif.Flash], [t("shotDetails.white_balance"), exif.WhiteBalance],
      [t("shotDetails.focus_mode"), focus], [t("shotDetails.metering_mode"), exif.MeteringMode]
    ]],
    [t("shotDetails.file"), [
      [t("shotDetails.filename"), file.name || name], [t("shotDetails.format"), format],
      [t("shotDetails.resolution"), width && height ? `${width} × ${height} px` : null],
      [t("shotDetails.size"), show(file.bytes, value => t("shotDetails.bytes", { v0: number(value) }))],
      [t("shotDetails.date_taken"), show(captureDate, value => Number.isNaN(Date.parse(value)) ? value : date(value,{dateStyle:'medium',timeStyle:'medium'}))],
      [t("shotDetails.color_space"), colorSpace],
      [t("shotDetails.orientation"), ifd.Orientation ?? file.orientation]
    ]]
  ].map(([title, rows]) => [title, rows.filter(([, value]) => hasValue(value)).map(([label, value]) => [label, readable(value)])])
    .filter(([, rows]) => rows.length);
}
